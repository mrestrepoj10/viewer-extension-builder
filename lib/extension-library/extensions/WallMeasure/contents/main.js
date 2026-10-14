;(() => {
  const TOOLBAR_GROUP = 'aps-extensions-toolbar'
  const TOOL_NAME = 'WallMeasure.tool'
  const OVERLAY = 'WallMeasure-overlay'
  const WALL_CATEGORIES = ['Revit Walls', 'Revit Curtain Panels', 'Revit Curtain Wall Mullions']
  const ESCAPE = 27

  class WallMeasureTool extends Autodesk.Viewing.ToolInterface {
    constructor(extension) {
      super()
      this.names = [TOOL_NAME]
      this.extension = extension
      // ToolInterface assigns its methods on the instance, which would shadow these class methods.
      delete this.getPriority
      delete this.activate
      delete this.deactivate
      delete this.handleSingleClick
      delete this.handleKeyDown
    }

    getPriority() {
      return 50
    }

    activate() {
      this.extension.onToolActivated()
    }

    deactivate() {
      this.extension.onToolDeactivated()
    }

    handleSingleClick(event, button) {
      if (button !== 0) return false
      this.extension.pick(event.canvasX, event.canvasY)
      return true
    }

    handleKeyDown(_event, keyCode) {
      if (keyCode !== ESCAPE) return false
      this.extension.clearMeasurement()
      return true
    }
  }

  function categoryOf(model, dbId) {
    return new Promise((resolve) =>
      model.getProperties(
        dbId,
        (result) => {
          const category = result.properties.find((item) => item.displayName === 'Category')
          resolve(category ? String(category.displayValue) : '')
        },
        () => resolve(''),
      ),
    )
  }

  class WallMeasure extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
      super(viewer, options)
      this.tool = new WallMeasureTool(this)
      this.group = null
      this.button = null
      this.points = []
      this.meshes = []
      this.hint = null
      this.label = null
      this.onCamera = this.onCamera.bind(this)
    }

    load() {
      this.viewer.toolController.registerTool(this.tool)
      this.viewer.overlays.addScene(OVERLAY)
      this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCamera)
      return true
    }

    unload() {
      this.viewer.toolController.deactivateTool(TOOL_NAME)
      this.viewer.toolController.deregisterTool(this.tool)
      this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCamera)
      this.clearMeasurement()
      this.viewer.overlays.removeScene(OVERLAY)
      this.hint?.remove()
      this.hint = null
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
      this.button = new Autodesk.Viewing.UI.Button('WallMeasure-button')
      this.button.setToolTip('Measure between two wall points')
      this.button.addClass('wall-measure-button')
      this.button.onClick = () => {
        const controller = this.viewer.toolController
        if (controller.isToolActivated(TOOL_NAME)) controller.deactivateTool(TOOL_NAME)
        else controller.activateTool(TOOL_NAME)
      }
      this.group.addControl(this.button)
    }

    onToolActivated() {
      this.button?.setState(Autodesk.Viewing.UI.Button.State.ACTIVE)
      if (!this.hint) {
        this.hint = document.createElement('div')
        this.hint.className = 'wall-measure-hint'
        this.hint.setAttribute('role', 'status')
        this.viewer.container.appendChild(this.hint)
      }
      this.setHint('Click a point on a wall.')
    }

    onToolDeactivated() {
      this.button?.setState(Autodesk.Viewing.UI.Button.State.INACTIVE)
      this.hint?.remove()
      this.hint = null
    }

    setHint(text) {
      if (this.hint) this.hint.textContent = text
    }

    async pick(canvasX, canvasY) {
      const hit = this.viewer.clientToWorld(canvasX, canvasY, true)
      if (!hit?.point) {
        this.setHint('Nothing there. Click a point on a wall.')
        return
      }
      const category = await categoryOf(hit.model || this.viewer.model, hit.dbId)
      if (!WALL_CATEGORIES.includes(category)) {
        const label = category.replace(/^Revit\s+/, '')
        this.setHint(category ? `That is ${label}, not a wall.` : 'Not a wall. Click a wall.')
        return
      }
      if (this.points.length === 2) this.clearMeasurement()
      this.points.push(hit.point.clone())
      this.addMarker(hit.point)
      if (this.points.length === 1) {
        this.setHint('Click a second point on a wall. Esc clears.')
        return
      }
      this.addLine(this.points[0], this.points[1])
      this.showDistance()
      this.setHint('Click a wall to start a new measurement. Esc clears.')
    }

    markerRadius() {
      return 0.15 / this.viewer.model.getUnitScale()
    }

    addMarker(point) {
      const geometry = new THREE.SphereGeometry(this.markerRadius(), 12, 12)
      const material = new THREE.MeshBasicMaterial({ color: 0xea580c, depthTest: false })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.copy(point)
      this.addMesh(mesh)
    }

    addLine(start, end) {
      const geometry = new THREE.Geometry()
      geometry.vertices.push(start.clone(), end.clone())
      const material = new THREE.LineBasicMaterial({
        color: 0xea580c,
        linewidth: 2,
        depthTest: false,
      })
      this.addMesh(new THREE.Line(geometry, material))
    }

    addMesh(mesh) {
      this.meshes.push(mesh)
      this.viewer.overlays.addMesh(mesh, OVERLAY)
    }

    showDistance() {
      const [start, end] = this.points
      const model = this.viewer.model
      const distance = start.distanceTo(end)
      const meters = distance * model.getUnitScale()
      const units = model.getUnitString()
      if (!this.label) {
        this.label = document.createElement('div')
        this.label.className = 'wall-measure-label'
        this.viewer.container.appendChild(this.label)
      }
      this.label.textContent =
        units === 'm'
          ? `${distance.toFixed(3)} m`
          : `${distance.toFixed(2)} ${units} · ${meters.toFixed(3)} m`
      this.onCamera()
    }

    onCamera() {
      if (!this.label || this.points.length < 2) return
      const middle = this.points[0].clone().add(this.points[1]).multiplyScalar(0.5)
      const screen = this.viewer.worldToClient(middle)
      this.label.style.left = `${screen.x}px`
      this.label.style.top = `${screen.y}px`
    }

    clearMeasurement() {
      for (const mesh of this.meshes) {
        this.viewer.overlays.removeMesh(mesh, OVERLAY)
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
      this.meshes = []
      this.points = []
      this.label?.remove()
      this.label = null
      if (this.hint) this.setHint('Click a point on a wall.')
    }
  }

  Autodesk.Viewing.theExtensionManager.registerExtension('WallMeasure', WallMeasure)
})()
