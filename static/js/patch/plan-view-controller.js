/**
 * Manages the 2D plan view with zoom, pan, and grid functionality
 */
class PlanViewController {
    constructor() {
        this.planView = null;
        this.planViewContent = null;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.gridSize = 50;
        this.gridEnabled = true;
        this.snapToGrid = true;
        this.isDraggingFixture = false;
        this.draggedFixture = null;
        this.dragOffset = { x: 0, y: 0 };
        this.planViewRect = null;
        this.justFinishedDrag = false;
        this.selectedFixtures = new Set();
        this.isSelecting = false;
        this.selectionStart = { x: 0, y: 0 };
        this.selectionBox = null;
    }
    
    initialize() {
        this.planView = document.getElementById('planView');
        this.planViewContent = document.getElementById('planViewContent');
        if (!this.planView || !this.planViewContent) return;
        
        this.planViewRect = this.planView.getBoundingClientRect();
        
        this.initializeGrid();
        this.initializeZoomPan();
        this.initializeSelection();
        
        window.addEventListener('resize', () => {
            this.planViewRect = this.planView.getBoundingClientRect();
            this.updateGrid();
            this.updateView([]);
        });
    }
    
    updateView(patchedDevices) {
        if (!this.planViewContent) return;
        
        // Clear existing fixtures
        this.planViewContent.querySelectorAll('.plan-fixture').forEach(f => f.remove());
        
        // Add patched devices
        patchedDevices.forEach(patch => {
            this.addFixtureToView(patch);
        });
    }
    
    addFixtureToView(patch) {
        const fixture = document.createElement('div');
        fixture.className = `plan-fixture ${patch.device.shape || 'circle'}`;
        fixture.dataset.patchId = patch.id;
        fixture.textContent = patch.start_address;
        fixture.title = patch.device.name;
        
        fixture.style.borderColor = patch.device.color || '#ffffff';
        
        let x = patch.x_position || 0;
        let y = patch.y_position || 0;
        
        // Convert percentage to pixels if needed
        if (x <= 100 && y <= 100 && x >= 0 && y >= 0) {
            const rect = this.planView.getBoundingClientRect();
            x = (x - 50) * (rect.width / 100);
            y = (y - 50) * (rect.height / 100);
        }
        
        // Position fixture (coordinates are relative to center)
        const rect = this.planView.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        fixture.style.left = `${centerX + x}px`;
        fixture.style.top = `${centerY + y}px`;
        
        // Add event listeners
        fixture.addEventListener('click', (e) => this.handleFixtureClick(e, patch));
        fixture.addEventListener('mousedown', (e) => this.startDragFixture(e, patch));
        
        this.planViewContent.appendChild(fixture);
    }
    
    handleFixtureClick(e, patch) {
        // Don't show device info if we just finished dragging
        if (this.justFinishedDrag) {
            this.justFinishedDrag = false;
            return;
        }
        
        // Handle multiselect with Ctrl+click
        if (e.ctrlKey || e.metaKey) {
            this.toggleFixtureSelection(patch.id);
        } else {
            // Clear selection and select only this fixture
            this.clearSelection();
            this.selectFixture(patch.id);
        }
        
        this.updateSelectionVisuals();
    }
    
    startDragFixture(e, patch) {
        e.preventDefault();
        const fixture = e.target;
        
        // If the clicked fixture is not selected, make it the only selection
        if (!this.isFixtureSelected(patch.id)) {
            this.clearSelection();
            this.selectFixture(patch.id);
            this.updateSelectionVisuals();
        }
        
        this.isDraggingFixture = true;
        this.draggedFixture = fixture;
        
        // Add dragging class to all selected fixtures
        this.getSelectedFixtures().forEach(patchId => {
            const selectedFixture = this.planViewContent.querySelector(`[data-patch-id="${patchId}"]`);
            if (selectedFixture) {
                selectedFixture.classList.add('dragging');
            }
        });
        
        const rect = this.planView.getBoundingClientRect();
        const fixtureRect = fixture.getBoundingClientRect();
        this.dragOffset.x = e.clientX - fixtureRect.left - 15;
        this.dragOffset.y = e.clientY - fixtureRect.top - 15;
        
        const onMouseMove = (e) => this.handleFixtureDragMove(e, fixture);
        const onMouseUp = (e) => this.handleFixtureDragEnd(e, patch, onMouseMove, onMouseUp);
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    
    handleFixtureDragMove(e, fixture) {
        if (!this.isDraggingFixture) return;
        
        const rect = this.planView.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        let x = (e.clientX - rect.left - this.dragOffset.x) - centerX;
        let y = (e.clientY - rect.top - this.dragOffset.y) - centerY;
        
        x = x / this.zoom;
        y = y / this.zoom;
        
        if (this.snapToGrid && this.gridEnabled) {
            x = Math.round(x / this.gridSize) * this.gridSize;
            y = Math.round(y / this.gridSize) * this.gridSize;
        }
        
        // Calculate offset from the main dragged fixture
        const mainPatch = this.getCurrentPatchData().find(p => 
            p.id === parseInt(this.draggedFixture.dataset.patchId));
        const deltaX = x - (mainPatch?.x_position || 0);
        const deltaY = y - (mainPatch?.y_position || 0);
        
        // Move all selected fixtures
        this.getSelectedFixtures().forEach(patchId => {
            const selectedFixture = this.planViewContent.querySelector(`[data-patch-id="${patchId}"]`);
            const selectedPatch = this.getCurrentPatchData().find(p => p.id === patchId);
            
            if (selectedFixture && selectedPatch) {
                const newX = (selectedPatch.x_position || 0) + deltaX;
                const newY = (selectedPatch.y_position || 0) + deltaY;
                
                selectedFixture.style.left = `${centerX + newX}px`;
                selectedFixture.style.top = `${centerY + newY}px`;
                
                if (this.snapToGrid && this.gridEnabled) {
                    selectedFixture.classList.add('snapped');
                } else {
                    selectedFixture.classList.remove('snapped');
                }
            }
        });
    }
    
    async handleFixtureDragEnd(e, patch, onMouseMove, onMouseUp) {
        if (!this.isDraggingFixture) return;
        
        this.isDraggingFixture = false;
        this.justFinishedDrag = true;
        
        // Remove dragging class from all selected fixtures
        this.getSelectedFixtures().forEach(patchId => {
            const selectedFixture = this.planViewContent.querySelector(`[data-patch-id="${patchId}"]`);
            if (selectedFixture) {
                selectedFixture.classList.remove('dragging', 'snapped');
            }
        });
        
        const rect = this.planView.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        let x = (e.clientX - rect.left - this.dragOffset.x) - centerX;
        let y = (e.clientY - rect.top - this.dragOffset.y) - centerY;
        
        x = x / this.zoom;
        y = y / this.zoom;
        
        if (this.snapToGrid && this.gridEnabled) {
            x = Math.round(x / this.gridSize) * this.gridSize;
            y = Math.round(y / this.gridSize) * this.gridSize;
        }
        
        // Calculate offset from the main dragged fixture
        const mainPatch = this.getCurrentPatchData().find(p => 
            p.id === parseInt(this.draggedFixture.dataset.patchId));
        const deltaX = x - (mainPatch?.x_position || 0);
        const deltaY = y - (mainPatch?.y_position || 0);
        
        try {
            // Update positions for all selected fixtures
            const updatePromises = this.getSelectedFixtures().map(async (patchId) => {
                const selectedPatch = this.getCurrentPatchData().find(p => p.id === patchId);
                if (selectedPatch) {
                    const newX = (selectedPatch.x_position || 0) + deltaX;
                    const newY = (selectedPatch.y_position || 0) + deltaY;
                    
                    const response = await PatchAPI.updatePatchPosition(patchId, newX, newY);
                    if (response.success) {
                        selectedPatch.x_position = newX;
                        selectedPatch.y_position = newY;
                        return true;
                    } else {
                        throw new Error(response.error || 'Unknown error');
                    }
                }
                return false;
            });
            
            await Promise.all(updatePromises);
            this.showNotification(`Updated ${this.getSelectedFixtures().length} fixture positions`, 'success');
            
        } catch (error) {
            console.error('Error updating positions:', error);
            // Revert all fixtures on error
            this.getSelectedFixtures().forEach(patchId => {
                const selectedPatch = this.getCurrentPatchData().find(p => p.id === patchId);
                if (selectedPatch) {
                    this.updateView([selectedPatch]);
                }
            });
            this.showNotification('Error updating positions: ' + error.message, 'error');
        }
        
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
    
    initializeGrid() {
        this.updateGrid();
    }
    
    updateGrid() {
        const gridContainer = document.getElementById('planViewGrid');
        if (!gridContainer || !this.planView) return;
        
        const rect = this.planView.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        gridContainer.innerHTML = '';
        
        if (!this.gridEnabled) return;
        
        const gridExtent = Math.max(rect.width, rect.height) * (2 / this.zoom);
        const gridSize = Math.max(gridExtent, 2000);
        
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.overflow = 'visible';
        
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        pattern.setAttribute('id', 'grid');
        pattern.setAttribute('width', this.gridSize);
        pattern.setAttribute('height', this.gridSize);
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${this.gridSize} 0 L 0 0 0 ${this.gridSize}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#ffffff');
        path.setAttribute('stroke-width', '1');
        path.setAttribute('opacity', '0.3');
        
        pattern.appendChild(path);
        defs.appendChild(pattern);
        svg.appendChild(defs);
        
        const rect_el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect_el.setAttribute('width', gridSize);
        rect_el.setAttribute('height', gridSize);
        rect_el.setAttribute('fill', 'url(#grid)');
        rect_el.setAttribute('x', centerX - gridSize / 2);
        rect_el.setAttribute('y', centerY - gridSize / 2);
        svg.appendChild(rect_el);
        
        // Add center axes
        const axisGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        const hAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hAxis.setAttribute('x1', centerX - gridSize / 2);
        hAxis.setAttribute('y1', centerY);
        hAxis.setAttribute('x2', centerX + gridSize / 2);
        hAxis.setAttribute('y2', centerY);
        hAxis.setAttribute('stroke', '#ff6b6b');
        hAxis.setAttribute('stroke-width', '2');
        hAxis.setAttribute('opacity', '0.7');
        
        const vAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        vAxis.setAttribute('x1', centerX);
        vAxis.setAttribute('y1', centerY - gridSize / 2);
        vAxis.setAttribute('x2', centerX);
        vAxis.setAttribute('y2', centerY + gridSize / 2);
        vAxis.setAttribute('stroke', '#ff6b6b');
        vAxis.setAttribute('stroke-width', '2');
        vAxis.setAttribute('opacity', '0.7');
        
        axisGroup.appendChild(hAxis);
        axisGroup.appendChild(vAxis);
        svg.appendChild(axisGroup);
        
        gridContainer.appendChild(svg);
    }
    
    toggleGrid() {
        this.gridEnabled = !this.gridEnabled;
        this.snapToGrid = this.gridEnabled;
        
        const button = document.getElementById('gridToggle');
        if (button) {
            button.classList.toggle('active', this.gridEnabled);
        }
        
        this.updateGrid();
    }
    
    initializeZoomPan() {
        if (!this.planView || !this.planViewContent) return;
        
        this.planView.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const rect = this.planView.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(0.1, Math.min(5, this.zoom * delta));
            
            this.setZoom(newZoom, mouseX, mouseY);
        });
        
        this.updateOriginPosition();
    }
    
    setZoom(newZoom, centerX = null, centerY = null) {
        if (!this.planViewContent) return;
        
        const rect = this.planView.getBoundingClientRect();
        const actualCenterX = centerX || rect.width / 2;
        const actualCenterY = centerY || rect.height / 2;
        
        this.zoom = newZoom;
        
        this.planViewContent.style.transform = `scale(${this.zoom})`;
        
        const gridContainer = document.getElementById('planViewGrid');
        if (gridContainer) {
            gridContainer.style.transform = `scale(${this.zoom})`;
        }
        
        this.updateGrid();
    }
    
    updateOriginPosition() {
        const origin = document.getElementById('planViewOrigin');
        if (!origin || !this.planView) return;
        
        const rect = this.planView.getBoundingClientRect();
        origin.style.left = `${rect.width / 2}px`;
        origin.style.top = `${rect.height / 2}px`;
    }
    
    zoomToFit(patchedDevices) {
        if (patchedDevices.length === 0) {
            this.setZoom(1);
            return;
        }
        
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        patchedDevices.forEach(patch => {
            let x = patch.x_position || 0;
            let y = patch.y_position || 0;
            
            if (x <= 100 && y <= 100 && x >= 0 && y >= 0) {
                const rect = this.planView.getBoundingClientRect();
                x = (x - 50) * (rect.width / 100);
                y = (y - 50) * (rect.height / 100);
            }
            
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        });
        
        const padding = 50;
        minX -= padding;
        maxX += padding;
        minY -= padding;
        maxY += padding;
        
        const rect = this.planView.getBoundingClientRect();
        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;
        
        const scaleX = rect.width / boundsWidth;
        const scaleY = rect.height / boundsHeight;
        const newZoom = Math.min(scaleX, scaleY, 2);
        
        this.setZoom(Math.max(0.1, newZoom));
    }
    
    showNotification(message, type) {
        if (typeof DMXUtils !== 'undefined' && DMXUtils.showNotification) {
            DMXUtils.showNotification(message, type);
        } else {
            alert(message);
        }
    }
    
    showDeviceInfo(patch) {
        // This will be handled by the main PatchManager
        if (this.eventHandler && this.eventHandler.showDeviceInfo) {
            this.eventHandler.showDeviceInfo(patch);
        }
    }
    
    setEventHandler(handler) {
        this.eventHandler = handler;
    }
    
    // === SELECTION METHODS ===
    
    selectFixture(patchId) {
        this.selectedFixtures.add(patchId);
    }
    
    deselectFixture(patchId) {
        this.selectedFixtures.delete(patchId);
    }
    
    toggleFixtureSelection(patchId) {
        if (this.selectedFixtures.has(patchId)) {
            this.deselectFixture(patchId);
        } else {
            this.selectFixture(patchId);
        }
    }
    
    clearSelection() {
        this.selectedFixtures.clear();
    }
    
    getSelectedFixtures() {
        return Array.from(this.selectedFixtures);
    }
    
    isFixtureSelected(patchId) {
        return this.selectedFixtures.has(patchId);
    }
    
    updateSelectionVisuals() {
        // Update visual styling for all fixtures
        this.planViewContent.querySelectorAll('.plan-fixture').forEach(fixture => {
            const patchId = parseInt(fixture.dataset.patchId);
            if (this.isFixtureSelected(patchId)) {
                fixture.classList.add('selected');
            } else {
                fixture.classList.remove('selected');
            }
        });
    }
    
    initializeSelection() {
        if (!this.planView) return;
        
        // Add mousedown event for selection box
        this.planView.addEventListener('mousedown', (e) => {
            this.handlePlanViewMouseDown(e);
        });
        
        // Add global mouse events for selection
        document.addEventListener('mousemove', (e) => {
            this.handleGlobalMouseMove(e);
        });
        
        document.addEventListener('mouseup', (e) => {
            this.handleGlobalMouseUp(e);
        });
    }
    
    handlePlanViewMouseDown(e) {
        // Only start selection if clicking on empty area (not on fixtures) and not already dragging
        if (!this.isDraggingFixture && 
            (e.target === this.planView || e.target === this.planViewContent || 
             e.target.classList.contains('plan-view-grid') || 
             e.target.closest('.plan-view-grid'))) {
            
            e.preventDefault();
            this.startSelection(e);
        }
    }
    
    startSelection(e) {
        this.isSelecting = true;
        const rect = this.planView.getBoundingClientRect();
        this.selectionStart.x = e.clientX - rect.left;
        this.selectionStart.y = e.clientY - rect.top;
        
        // Clear previous selection if not holding Ctrl
        if (!e.ctrlKey && !e.metaKey) {
            this.clearSelection();
            this.updateSelectionVisuals();
        }
        
        this.createSelectionBox();
    }
    
    createSelectionBox() {
        this.selectionBox = document.createElement('div');
        this.selectionBox.className = 'selection-box';
        this.selectionBox.style.position = 'absolute';
        this.selectionBox.style.border = '2px dashed #007bff';
        this.selectionBox.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
        this.selectionBox.style.pointerEvents = 'none';
        this.selectionBox.style.zIndex = '1000';
        this.selectionBox.style.left = `${this.selectionStart.x}px`;
        this.selectionBox.style.top = `${this.selectionStart.y}px`;
        this.selectionBox.style.width = '0px';
        this.selectionBox.style.height = '0px';
        
        this.planView.appendChild(this.selectionBox);
    }
    
    handleGlobalMouseMove(e) {
        if (!this.isSelecting || !this.selectionBox) return;
        
        const rect = this.planView.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        const left = Math.min(this.selectionStart.x, currentX);
        const top = Math.min(this.selectionStart.y, currentY);
        const width = Math.abs(currentX - this.selectionStart.x);
        const height = Math.abs(currentY - this.selectionStart.y);
        
        this.selectionBox.style.left = `${left}px`;
        this.selectionBox.style.top = `${top}px`;
        this.selectionBox.style.width = `${width}px`;
        this.selectionBox.style.height = `${height}px`;
    }
    
    handleGlobalMouseUp(e) {
        if (!this.isSelecting) return;
        
        this.finishSelection();
        this.isSelecting = false;
        
        if (this.selectionBox) {
            this.selectionBox.remove();
            this.selectionBox = null;
        }
    }
    
    finishSelection() {
        if (!this.selectionBox) return;
        
        const boxRect = this.selectionBox.getBoundingClientRect();
        const planRect = this.planView.getBoundingClientRect();
        
        // Convert to plan view coordinates
        const selectionRect = {
            left: boxRect.left - planRect.left,
            top: boxRect.top - planRect.top,
            right: boxRect.right - planRect.left,
            bottom: boxRect.bottom - planRect.top
        };
        
        // Check which fixtures are within the selection box
        this.planViewContent.querySelectorAll('.plan-fixture').forEach(fixture => {
            const fixtureRect = fixture.getBoundingClientRect();
            const fixtureCenter = {
                x: fixtureRect.left + fixtureRect.width / 2 - planRect.left,
                y: fixtureRect.top + fixtureRect.height / 2 - planRect.top
            };
            
            // Check if fixture center is within selection box
            if (fixtureCenter.x >= selectionRect.left && 
                fixtureCenter.x <= selectionRect.right &&
                fixtureCenter.y >= selectionRect.top && 
                fixtureCenter.y <= selectionRect.bottom) {
                
                const patchId = parseInt(fixture.dataset.patchId);
                this.selectFixture(patchId);
            }
        });
        
        this.updateSelectionVisuals();
    }
    
    getCurrentPatchData() {
        // Get current patch data from the event handler (PatchManager)
        if (this.eventHandler && this.eventHandler.patchedDevices) {
            return this.eventHandler.patchedDevices;
        }
        return [];
    }
}