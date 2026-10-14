;(() => {
  const TOOLBAR_GROUP = 'aps-extensions-toolbar'
  const CATEGORY = 'Revit Doors'

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

  function propertyValue(result, name) {
    const property = result.properties.find(
      (item) => item.displayName === name && item.displayCategory !== '__internalref__',
    )
    return property && property.displayValue !== '' ? String(property.displayValue) : ''
  }

  async function collectDoorTypes(model) {
    const matches = await new Promise((resolve, reject) =>
      model.search(CATEGORY, resolve, reject, ['Category'], { searchHidden: true }),
    )
    const tree = model.getInstanceTree()
    const leaves = matches.filter((dbId) => tree.getChildCount(dbId) === 0)
    const results = await new Promise((resolve, reject) =>
      model.getBulkProperties2(
        leaves,
        { propFilter: ['name', 'Category', 'Type Name', 'Level'] },
        resolve,
        reject,
      ),
    )
    const types = new Map()
    for (const result of results) {
      if (propertyValue(result, 'Category') !== CATEGORY) continue
      const family = (result.name || '').replace(/\s*\[\d+\]$/, '')
      const typeName = propertyValue(result, 'Type Name')
      const key = `${family}\u0000${typeName}`
      if (!types.has(key)) types.set(key, { family, typeName, dbIds: [], levels: new Map() })
      const entry = types.get(key)
      entry.dbIds.push(result.dbId)
      const level = propertyValue(result, 'Level') || 'No level'
      entry.levels.set(level, (entry.levels.get(level) || 0) + 1)
    }
    return [...types.values()].sort(
      (a, b) =>
        b.dbIds.length - a.dbIds.length ||
        a.family.localeCompare(b.family) ||
        a.typeName.localeCompare(b.typeName),
    )
  }

  class DoorSchedulePanel extends Autodesk.Viewing.UI.DockingPanel {
    constructor(viewer, onVisibility) {
      super(viewer.container, 'DoorSchedule-panel', 'Door schedule')
      this.onVisibility = onVisibility
      this.container.classList.add('door-schedule-panel')
      this.container.style.left = '16px'
      this.container.style.top = '16px'
      this.container.style.width = '320px'
      this.container.style.height = '420px'
      this.createScrollContainer({ heightAdjustment: 45 })
      this.body = document.createElement('div')
      this.body.className = 'door-schedule-body'
      this.scrollContainer.appendChild(this.body)
    }

    setVisible(show) {
      super.setVisible(show)
      if (this.onVisibility) this.onVisibility(show)
    }

    showMessage(text) {
      const message = document.createElement('p')
      message.className = 'door-schedule-message'
      message.textContent = text
      this.body.replaceChildren(message)
    }

    render(types, onPick) {
      const total = types.reduce((sum, type) => sum + type.dbIds.length, 0)
      const summary = document.createElement('p')
      summary.className = 'door-schedule-summary'
      summary.textContent = `${total} doors in ${types.length} types`
      const list = document.createElement('div')
      list.className = 'door-schedule-list'
      for (const type of types) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'door-schedule-row'
        button.title = 'Select and zoom to these doors'
        const name = document.createElement('span')
        name.className = 'door-schedule-name'
        name.textContent = type.typeName ? `${type.family} · ${type.typeName}` : type.family
        const count = document.createElement('span')
        count.className = 'door-schedule-count'
        count.textContent = String(type.dbIds.length)
        const levels = document.createElement('span')
        levels.className = 'door-schedule-levels'
        levels.textContent = [...type.levels]
          .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
          .map(([level, n]) => `${level}: ${n}`)
          .join(' · ')
        button.append(name, count, levels)
        button.addEventListener('click', () => onPick(type))
        list.appendChild(button)
      }
      this.body.replaceChildren(summary, list)
    }
  }

  class DoorSchedule extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
      super(viewer, options)
      this.group = null
      this.button = null
      this.panel = null
      this.types = null
      this.selected = false
    }

    load() {
      return true
    }

    unload() {
      if (this.selected) this.viewer.clearSelection()
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
      this.button = new Autodesk.Viewing.UI.Button('DoorSchedule-button')
      this.button.setToolTip('Door schedule')
      this.button.addClass('door-schedule-button')
      this.button.onClick = () => this.togglePanel()
      this.group.addControl(this.button)
    }

    togglePanel() {
      if (!this.panel) {
        this.panel = new DoorSchedulePanel(this.viewer, (show) => {
          this.button?.setState(
            show
              ? Autodesk.Viewing.UI.Button.State.ACTIVE
              : Autodesk.Viewing.UI.Button.State.INACTIVE,
          )
        })
        this.viewer.addPanel(this.panel)
      }
      const show = !this.panel.isVisible()
      this.panel.setVisible(show)
      if (show && !this.types) this.refresh()
    }

    async refresh() {
      this.panel.showMessage('Counting doors…')
      try {
        const model = await modelReady(this.viewer)
        this.types = await collectDoorTypes(model)
        if (!this.panel) return
        if (this.types.length === 0) this.panel.showMessage('No doors in this model.')
        else this.panel.render(this.types, (type) => this.focus(type))
      } catch (error) {
        this.panel?.showMessage(`Could not read doors: ${error?.message || error}`)
      }
    }

    focus(type) {
      const model = this.viewer.model
      this.viewer.select(type.dbIds, model)
      this.selected = true
      this.viewer.fitToView(type.dbIds, model)
    }
  }

  Autodesk.Viewing.theExtensionManager.registerExtension('DoorSchedule', DoorSchedule)
})()
