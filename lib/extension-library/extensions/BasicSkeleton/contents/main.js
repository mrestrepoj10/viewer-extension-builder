;(() => {
  const TOOLBAR_GROUP = 'aps-extensions-toolbar'

  class BasicSkeleton extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
      super(viewer, options)
      this.group = null
      this.button = null
      this.onSelection = this.onSelection.bind(this)
    }

    load() {
      this.viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection)
      return true
    }

    unload() {
      this.viewer.removeEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection)
      if (this.group && this.button) {
        this.group.removeControl(this.button)
        if (this.group.getNumberOfControls() === 0) this.viewer.toolbar.removeControl(this.group)
      }
      this.group = null
      this.button = null
      return true
    }

    // Called after load() once the toolbar exists, or right away when it already does.
    onToolbarCreated(toolbar) {
      this.group = toolbar.getControl(TOOLBAR_GROUP)
      if (!this.group) {
        this.group = new Autodesk.Viewing.UI.ControlGroup(TOOLBAR_GROUP)
        toolbar.addControl(this.group)
      }
      this.button = new Autodesk.Viewing.UI.Button('BasicSkeleton-button')
      this.button.setToolTip('Basic Skeleton')
      this.button.addClass('basic-skeleton-button')
      this.button.onClick = () => {
        const active = this.button.getState() === Autodesk.Viewing.UI.Button.State.ACTIVE
        this.button.setState(
          active
            ? Autodesk.Viewing.UI.Button.State.INACTIVE
            : Autodesk.Viewing.UI.Button.State.ACTIVE,
        )
      }
      this.group.addControl(this.button)
    }

    onSelection(event) {
      console.log(`BasicSkeleton: ${event.dbIdArray.length} selected`)
    }
  }

  Autodesk.Viewing.theExtensionManager.registerExtension('BasicSkeleton', BasicSkeleton)
})()
