;(() => {
  const TOOLBAR_GROUP = 'aps-extensions-toolbar'
  const LEVEL_PROPERTIES = ['Level', 'Base Constraint', 'Reference Level', 'Schedule Level']
  const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777']

  function modelReady(viewer) {
    const model = viewer.model
    if (model?.isObjectTreeCreated()) return Promise.resolve(model)
    return new Promise((resolve) => {
      const onTree = (event) => {
        viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTree)
        resolve(event.model || viewer.model)
      }
      viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTree)
    })
  }

  function bulkProperties(model, dbIds, propFilter) {
    return new Promise((resolve, reject) =>
      model.getBulkProperties2(dbIds, { propFilter }, resolve, reject),
    )
  }

  function propertyValue(result, name) {
    const property = result.properties.find(
      (item) => item.displayName === name && item.displayCategory !== '__internalref__',
    )
    return property && property.displayValue !== '' ? String(property.displayValue) : ''
  }

  function toVector4(hex) {
    const value = Number.parseInt(hex.slice(1), 16)
    return new THREE.Vector4(
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255,
      1,
    )
  }

  async function collectLevels(model) {
    const tree = model.getInstanceTree()
    const leaves = []
    tree.enumNodeChildren(
      tree.getRootId(),
      (dbId) => {
        if (tree.getChildCount(dbId) === 0) leaves.push(dbId)
      },
      true,
    )
    const results = await bulkProperties(model, leaves, ['Category', ...LEVEL_PROPERTIES])
    const byName = new Map()
    const entry = (name) => {
      if (!byName.has(name)) byName.set(name, { name, elevation: null, all: [], floors: [] })
      return byName.get(name)
    }

    const doc = model.getDocumentNode()?.getDocument()
    const aec = doc ? await doc.downloadAecModelData().catch(() => null) : null
    for (const level of aec?.levels || []) entry(level.name).elevation = level.elevation

    for (const result of results) {
      const name = LEVEL_PROPERTIES.map((prop) => propertyValue(result, prop)).find(Boolean)
      if (!name) continue
      const level = entry(name)
      level.all.push(result.dbId)
      if (propertyValue(result, 'Category') === 'Revit Floors') level.floors.push(result.dbId)
    }

    const levels = [...byName.values()].filter((level) => level.all.length > 0)
    levels.sort(
      (a, b) =>
        (a.elevation ?? Number.POSITIVE_INFINITY) - (b.elevation ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    )
    return levels.map((level, index) => ({ ...level, color: PALETTE[index % PALETTE.length] }))
  }

  class LevelColorsPanel extends Autodesk.Viewing.UI.DockingPanel {
    constructor(viewer, onVisibility) {
      super(viewer.container, 'LevelColors-panel', 'Level colors')
      this.onVisibility = onVisibility
      this.container.classList.add('level-colors-panel')
      this.container.style.left = '16px'
      this.container.style.top = '16px'
      this.container.style.width = '280px'
      this.container.style.height = '440px'
      this.createScrollContainer({ heightAdjustment: 45 })
      this.list = document.createElement('div')
      this.list.className = 'level-colors-list'
      this.scrollContainer.appendChild(this.list)
    }

    setVisible(show) {
      super.setVisible(show)
      if (this.onVisibility) this.onVisibility(show)
    }

    showMessage(text) {
      this.list.replaceChildren()
      const message = document.createElement('p')
      message.className = 'level-colors-message'
      message.textContent = text
      this.list.appendChild(message)
    }

    render(levels, activeName, onPick) {
      this.list.replaceChildren()
      const rows = [{ name: 'All levels', all: null, floors: null, color: null }, ...levels]
      for (const level of rows) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'level-colors-row'
        button.setAttribute('aria-pressed', String(level.name === activeName))
        const swatch = document.createElement('span')
        swatch.className = 'level-colors-swatch'
        if (level.color) swatch.style.backgroundColor = level.color
        else swatch.classList.add('level-colors-swatch--all')
        const label = document.createElement('span')
        label.className = 'level-colors-label'
        label.textContent = level.name
        const detail = document.createElement('span')
        detail.className = 'level-colors-detail'
        detail.textContent = level.all
          ? `${level.floors.length} floors · ${level.all.length} elements`
          : 'colour every level'
        button.append(swatch, label, detail)
        button.addEventListener('click', () => onPick(level.all ? level : null))
        this.list.appendChild(button)
      }
    }
  }

  class LevelColors extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
      super(viewer, options)
      this.group = null
      this.button = null
      this.panel = null
      this.levels = null
      this.active = null
    }

    load() {
      return true
    }

    unload() {
      this.clearDisplay()
      if (this.panel) {
        this.panel.onVisibility = null
        this.viewer.removePanel(this.panel)
        this.panel.uninitialize()
        this.panel = null
      }
      if (this.group && this.button) {
        this.group.removeControl(this.button)
        if (this.group.getNumberOfControls() === 0) this.viewer.toolbar.removeControl(this.group)
      }
      this.group = null
      this.button = null
      return true
    }

    onToolbarCreated(toolbar) {
      this.group = toolbar.getControl(TOOLBAR_GROUP)
      if (!this.group) {
        this.group = new Autodesk.Viewing.UI.ControlGroup(TOOLBAR_GROUP)
        toolbar.addControl(this.group)
      }
      this.button = new Autodesk.Viewing.UI.Button('LevelColors-button')
      this.button.setToolTip('Level colors')
      this.button.addClass('level-colors-button')
      this.button.onClick = () => this.togglePanel()
      this.group.addControl(this.button)
    }

    togglePanel() {
      if (!this.panel) {
        this.panel = new LevelColorsPanel(this.viewer, (show) => {
          if (this.button) {
            this.button.setState(
              show
                ? Autodesk.Viewing.UI.Button.State.ACTIVE
                : Autodesk.Viewing.UI.Button.State.INACTIVE,
            )
          }
        })
        this.viewer.addPanel(this.panel)
      }
      const show = !this.panel.isVisible()
      this.panel.setVisible(show)
      if (show && !this.levels) this.refresh()
    }

    async refresh() {
      this.panel.showMessage('Reading levels…')
      try {
        const model = await modelReady(this.viewer)
        this.levels = await collectLevels(model)
        if (!this.panel) return
        if (this.levels.length === 0) this.panel.showMessage('This model has no level data.')
        else this.renderPanel()
      } catch (error) {
        if (this.panel) this.panel.showMessage(`Could not read levels: ${error?.message || error}`)
      }
    }

    renderPanel() {
      this.panel.render(this.levels, this.active ? this.active.name : 'All levels', (level) =>
        this.pick(level),
      )
    }

    pick(level) {
      const model = this.viewer.model
      this.active = level
      this.viewer.clearThemingColors(model)
      if (level) {
        const color = toVector4(level.color)
        for (const dbId of level.floors) this.viewer.setThemingColor(dbId, color, model)
        this.viewer.isolate(level.all, model)
        this.viewer.fitToView(level.all, model)
      } else {
        for (const each of this.levels) {
          const color = toVector4(each.color)
          for (const dbId of each.floors) this.viewer.setThemingColor(dbId, color, model)
        }
        this.viewer.showAll()
        this.viewer.fitToView()
      }
      this.renderPanel()
    }

    clearDisplay() {
      if (!this.viewer.model) return
      this.viewer.clearThemingColors(this.viewer.model)
      if (this.active) this.viewer.showAll()
      this.active = null
    }
  }

  Autodesk.Viewing.theExtensionManager.registerExtension('LevelColors', LevelColors)
})()
