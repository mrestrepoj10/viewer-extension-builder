# Viewer v7 extensions

Write Viewer v7 extensions (aps-extensions format) and load them into the live viewer.

## Folder contract
- `/model/extensions/<Id>/config.json`: as in the skeleton; `name` and `bundleAlias` are `<Id>`.
- `contents/main.js`: a plain script. No import, require or export. Wrap the whole file in `(() => { ... })()` so a reload does not redeclare top-level const or class.
- `contents/main.css`: optional; prefix classes with the extension name.
- References to copy from: `BasicSkeleton`, `LevelColors` (toolbar, DockingPanel, theming, isolate), `DoorSchedule` (search, bulk properties, fitToView), `WallMeasure` (ToolInterface, overlay, label).

## Commands
- `ext new <Id> [--from <Example>]`, `ext list`, `ext check`, `ext load`, `ext click <Id> <control-id>`, `ext unload`, `ext errors`, `ext export`.
- `docs grep <pattern>`, `docs show <path>`: offline Viewer v7 and Data Visualization docs (`/docs/INDEX.txt` lists pages; line 1 of a page is its portal URL to cite). Check APIs there first.
- Loop: edit, `ext check`, `ext load`, `ext click` your button, `viewer take_screenshot`, fix, `ext load` again (it replaces the old one).

## Lifecycle
`class X extends Autodesk.Viewing.Extension` with `load()` and `unload()`, both returning true, then `Autodesk.Viewing.theExtensionManager.registerExtension('<Id>', X)`. The id must match the folder and config name. `unload()` undoes everything: listeners, controls, panels, tools, overlays, theming, isolation, DOM nodes. If `!viewer.model?.isObjectTreeCreated()` at load, wait for `OBJECT_TREE_CREATED_EVENT`. `onToolbarCreated(toolbar)` runs after `load()`, at once if the toolbar already exists.

## Toolbar
Reuse `toolbar.getControl('aps-extensions-toolbar')` or add `new Autodesk.Viewing.UI.ControlGroup('aps-extensions-toolbar')`. `new Autodesk.Viewing.UI.Button('<Id>-button')`, `setToolTip`, `addClass`, `onClick`, `group.addControl(button)`, `setState(Autodesk.Viewing.UI.Button.State.ACTIVE | INACTIVE)`. On unload: `group.removeControl(button)`, and remove the group when `getNumberOfControls() === 0`. Icon: style `.<class> .adsk-button-icon` with a CSS mask and `background-color: currentColor` so it follows the theme.

## DockingPanel
`class P extends Autodesk.Viewing.UI.DockingPanel`, `super(viewer.container, '<Id>-panel', 'Title')`, place it top-left with `this.container.style` (left/top 16px, under 60% of the viewer height: the Extensions overlay sits bottom-left, the ViewCube top-right), `this.createScrollContainer()`, append to `this.scrollContainer`. `viewer.addPanel(p)`, `p.setVisible(true)`. Override `setVisible` to sync the button; the close X calls it. On unload: `viewer.removePanel(p)`, `p.uninitialize()`. Build content with DOM APIs and `textContent`; real `<button>`s, 44px tall.

## Tools
`class T extends Autodesk.Viewing.ToolInterface`: in the constructor call `super()`, set `this.names = ['<Id>.tool']`, then `delete this.handleSingleClick` (and every other method you define). ToolInterface assigns its methods on the instance; without the delete yours never run. `handleSingleClick(event, button)` gets `event.canvasX/canvasY`. Return true to consume it (no selection). Also `handleKeyDown(event, keyCode)`, `handleMouseMove`, `getPriority`, `activate`, `deactivate`. `viewer.toolController`: `registerTool(t)` in load, `activateTool(name)`, `deactivateTool(name)`, `isToolActivated(name)`, `deregisterTool(t)` on unload. `viewer.clientToWorld(x, y, true)` returns `{dbId, point, model}`; `viewer.worldToClient(point)` gives screen coordinates. Overlays: `viewer.overlays.addScene(n)`, `addMesh(mesh, n)`, `removeMesh`, `removeScene`. THREE is r71, so `THREE.Geometry`, `THREE.Line`, `MeshBasicMaterial({depthTest: false})`. Dispose geometry and materials.

## Events
`viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, fn)` (`event.dbIdArray`), also `ISOLATE_EVENT`, `CAMERA_CHANGE_EVENT`, `GEOMETRY_LOADED_EVENT`. Bind handlers in the constructor so `removeEventListener` gets the same function.

## Model data
- `tree = model.getInstanceTree()`, `tree.enumNodeChildren(tree.getRootId(), cb, true)`. Leaves have `tree.getChildCount(id) === 0`.
- `model.search('Revit Doors', ok, err, ['Category'], {searchHidden: true})`, then keep the leaves.
- `model.getBulkProperties2(ids, {propFilter: ['name', 'Category', 'Type Name', 'Level']}, ok, err)` and `model.getProperties(dbId, ok, err)`. Skip properties whose `displayCategory` is `'__internalref__'`.
- Categories read `Revit Walls`, `Revit Floors`, `Revit Doors`. Instance names end in ` [elementId]`; strip it to get the family.
- Levels: `(await model.getDocumentNode().getDocument().downloadAecModelData()).levels` holds `{name, elevation}`. Elements carry `Level` or `Base Constraint`.
- Units: `model.getUnitString()` (`ft` here), `model.getUnitScale()` (metres per unit); world distances are in model units.

## Display
`viewer.select(ids)`, `clearSelection()`, `isolate(ids)`, `showAll()`, `hide(ids)`, `show(ids)`, `fitToView(ids)`, `setThemingColor(dbId, new THREE.Vector4(r, g, b, 1), model)` (0 to 1), `clearThemingColors(model)`.

## This model
Commercial Office (Revit, feet): walls, curtain walls, floors, roofs, ceilings, columns, doors, stairs, railings, grids, Levels 1 to 4. It has NO rooms. Data Visualization room heatmaps (`generateSurfaceShadingData`, `LevelRoomsMap`) find nothing: build `SurfaceShadingData` by hand from floor dbIds ("Applying Heatmaps to Arbitrary Models"), or use sprites or theming.

## Debugging a failed load
1. `ext check <Id>`: syntax and lint at line:col.
2. `ext load` prints `load() → false` or the error at line:col in `ext/<Id>/main.js`. `Extension not found ... registered` means registerExtension never ran: the script threw first, or the id differs.
3. `Identifier ... has already been declared` means a top-level const or class sits outside the IIFE wrapper.
4. `ext errors <Id>`: errors thrown after load (handlers, async work). Catch async errors and show them in the UI.
5. Missing UI: no `onToolbarCreated`, a wrong CSS class, or no `setVisible(true)`. `ext click` shows what a click opens.
