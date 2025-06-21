/**
 * Handles API communication for patch operations
 */
class PatchAPI {
    static async call(url, method = 'GET', data = null) {
        console.log('API call:', { url, method, data });
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };
        
        if (data) {
            options.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(url, options);
            console.log('API response status:', response.status, response.statusText);
            
            if (!response.ok) {
                const errorData = await response.json();
                console.log('API error response:', errorData);
                return { success: false, error: errorData.error || 'Unknown error' };
            }
            
            const result = await response.json();
            console.log('API response data:', result);
            return result;
        } catch (error) {
            console.error('API call failed:', error);
            throw error;
        }
    }
    
    static async patchDevice(deviceId, startAddress) {
        return this.call('/api/patch-device', 'POST', {
            device_id: parseInt(deviceId),
            start_address: startAddress
        });
    }
    
    static async unpatchDevice(patchId) {
        return this.call('/api/unpatch-device', 'POST', {
            patch_id: patchId
        });
    }
    
    static async updatePatchPosition(patchId, x, y) {
        return this.call('/api/update-patch-position', 'POST', {
            patch_id: patchId,
            x_position: x,
            y_position: y
        });
    }
    
    static async updatePatchAddress(patchId, newAddress) {
        return this.call('/api/update-patch-address', 'POST', {
            patch_id: patchId,
            start_address: newAddress
        });
    }
    
    static async getPatchedDevices() {
        return this.call('/api/patched-devices');
    }
    
    static async clearAllPatch() {
        return this.call('/api/clear-all-patch', 'POST');
    }
    
    static async exportPatch() {
        return this.call('/api/export-patch');
    }
}

/**
 * Manages device selection and multi-select operations
 */
class DeviceSelectionManager {
    constructor() {
        this.selectedDevices = new Set();
        this.isDragging = false;
        this.dragStartAddress = null;
    }
    
    selectDevice(patchId) {
        this.selectedDevices.add(patchId);
    }
    
    deselectDevice(patchId) {
        this.selectedDevices.delete(patchId);
    }
    
    toggleDevice(patchId) {
        if (this.selectedDevices.has(patchId)) {
            this.deselectDevice(patchId);
        } else {
            this.selectDevice(patchId);
        }
    }
    
    clearSelection() {
        this.selectedDevices.clear();
    }
    
    selectRange(startPatch, endPatch, allPatches) {
        const startAddr = Math.min(startPatch.start_address, endPatch.start_address);
        const endAddr = Math.max(startPatch.start_address, endPatch.start_address);
        
        allPatches.forEach(patch => {
            if (patch.start_address >= startAddr && patch.start_address <= endAddr) {
                this.selectDevice(patch.id);
            }
        });
    }
    
    selectAll(allPatches) {
        this.clearSelection();
        allPatches.forEach(patch => {
            this.selectDevice(patch.id);
        });
    }
    
    getSelectedDevices() {
        return Array.from(this.selectedDevices);
    }
    
    hasSelection() {
        return this.selectedDevices.size > 0;
    }
    
    isSelected(patchId) {
        return this.selectedDevices.has(patchId);
    }
    
    getSelectionCount() {
        return this.selectedDevices.size;
    }
    
    startDrag(address) {
        this.isDragging = true;
        this.dragStartAddress = address;
        document.body.style.cursor = 'grabbing';
    }
    
    stopDrag() {
        this.isDragging = false;
        this.dragStartAddress = null;
        document.body.style.cursor = '';
    }
    
    isDraggingActive() {
        return this.isDragging;
    }
}

/**
 * Manages the DMX address grid display and interactions
 */
class DMXGridManager {
    constructor(selectionManager) {
        this.selectionManager = selectionManager;
        this.addressesPerRow = 16;
        this.globalListenersAdded = false;
    }
    
    generateGrid() {
        const grid = document.getElementById('dmxGrid');
        if (!grid) {
            console.error('DMX Grid element not found!');
            return;
        }
        
        console.log('Generating DMX grid...');
        grid.innerHTML = '';
        
        for (let i = 1; i <= 512; i++) {
            const address = document.createElement('div');
            address.className = 'dmx-address';
            address.dataset.address = i;
            address.textContent = i;
            
            this.addAddressEventListeners(address, i);
            grid.appendChild(address);
        }
        
        this.addGlobalEventListeners();
        console.log('DMX Grid generated with 512 addresses');
    }
    
    addAddressEventListeners(address, addressNum) {
        address.addEventListener('click', (e) => {
            this.handleAddressClick(e, addressNum);
        });
        address.addEventListener('mousedown', (e) => {
            this.handleMouseDown(e, addressNum);
        });
        address.addEventListener('mouseup', (e) => {
            this.handleMouseUp(e, addressNum);
        });
        address.addEventListener('mousemove', (e) => {
            if (this.selectionManager.isDraggingActive()) {
                this.handleMouseMove(e, addressNum);
            }
        });
        address.addEventListener('contextmenu', (e) => {
            this.handleContextMenu(e, addressNum);
        });
    }
    
    addGlobalEventListeners() {
        if (!this.globalListenersAdded) {
            document.addEventListener('mouseup', () => this.handleGlobalMouseUp());
            document.addEventListener('keydown', (e) => this.handleKeyDown(e));
            this.globalListenersAdded = true;
        }
    }
    
    updateDisplay(patchedDevices) {
        console.log('Updating DMX grid display with', patchedDevices.length, 'patched devices');
        
        // Clear current display
        document.querySelectorAll('.dmx-address').forEach(addr => {
            addr.className = 'dmx-address';
            addr.removeAttribute('data-device-name');
            addr.textContent = addr.dataset.address;
        });
        
        // Remove existing device name labels
        document.querySelectorAll('.device-name-label').forEach(label => {
            label.remove();
        });
        
        // Update with patched devices
        patchedDevices.forEach(patch => {
            this.displayPatchedDevice(patch);
        });
    }
    
    displayPatchedDevice(patch) {
        const device = patch.device;
        const channels = this.parseDeviceChannels(device);
        const channelCount = channels.length || 1;
        
        console.log(`Displaying device: ${device.name}, channels: ${channelCount}, start: ${patch.start_address}`);
        
        // Mark addresses as occupied
        for (let i = 0; i < channelCount; i++) {
            const address = patch.start_address + i;
            const element = document.querySelector(`[data-address="${address}"]`);
            if (element) {
                if (i === 0) {
                    element.classList.add('occupied', 'device-start');
                    element.title = `${device.name} (Start)`;
                    element.setAttribute('data-device-name', device.name);
                    this.createDeviceLabel(element, device.name, channelCount);
                } else {
                    element.classList.add('partial');
                    element.title = `${device.name} (Ch ${i + 1})`;
                }
            }
        }
    }
    
    createDeviceLabel(firstAddressElement, deviceName, channelCount) {
        console.log(`Creating device label for ${deviceName}, channels: ${channelCount}`);
        const dmxGrid = document.getElementById('dmxGrid');
        if (!dmxGrid) return;
        
        setTimeout(() => {
            const startAddress = parseInt(firstAddressElement.dataset.address);
            const currentRow = Math.floor((startAddress - 1) / this.addressesPerRow);
            const positionInRow = (startAddress - 1) % this.addressesPerRow;
            const channelsOnCurrentRow = Math.min(channelCount, this.addressesPerRow - positionInRow);
            
            this.createSingleRowLabel(dmxGrid, firstAddressElement, deviceName, channelsOnCurrentRow, channelCount, startAddress);
            
            let remainingChannels = channelCount - channelsOnCurrentRow;
            let currentAddress = startAddress + channelsOnCurrentRow;
            
            while (remainingChannels > 0) {
                const channelsOnThisRow = Math.min(remainingChannels, this.addressesPerRow);
                const addressElement = document.querySelector(`[data-address="${currentAddress}"]`);
                
                if (addressElement) {
                    this.createSingleRowLabel(dmxGrid, addressElement, deviceName, channelsOnThisRow, channelCount, startAddress);
                }
                
                remainingChannels -= channelsOnThisRow;
                currentAddress += channelsOnThisRow;
            }
        }, 50);
    }
    
    createSingleRowLabel(dmxGrid, firstAddressElement, deviceName, channelsInThisRow, totalChannels, originalStartAddress) {
        const label = document.createElement('div');
        label.className = 'device-name-label';
        label.textContent = deviceName;
        label.title = `${deviceName} (${totalChannels} channels)`;
        label.dataset.deviceAddress = originalStartAddress;
        
        const gridRect = dmxGrid.getBoundingClientRect();
        const addressRect = firstAddressElement.getBoundingClientRect();
        
        const left = addressRect.left - gridRect.left;
        const top = addressRect.top - gridRect.top;
        
        const boxWidth = 40;
        const gapWidth = 2;
        const labelWidth = (channelsInThisRow * boxWidth) + ((channelsInThisRow - 1) * gapWidth);
        
        label.style.position = 'absolute';
        label.style.left = `${left}px`;
        label.style.top = `${top}px`;
        label.style.width = `${labelWidth}px`;
        label.style.zIndex = '10';
        label.style.cursor = 'pointer';
        
        this.addLabelEventListeners(label, originalStartAddress);
        dmxGrid.appendChild(label);
    }
    
    addLabelEventListeners(label, address) {
        label.addEventListener('click', (e) => {
            this.handleAddressClick(e, address);
        });
        label.addEventListener('mousedown', (e) => {
            this.handleMouseDown(e, address);
        });
        label.addEventListener('mouseup', (e) => {
            this.handleMouseUp(e, address);
        });
        label.addEventListener('contextmenu', (e) => {
            this.handleContextMenu(e, address);
        });
    }
    
    parseDeviceChannels(device) {
        if (!device.channels) return [];
        
        if (typeof device.channels === 'string') {
            try {
                return JSON.parse(device.channels);
            } catch (e) {
                console.error('Error parsing device channels JSON:', e);
                return [];
            }
        } else if (Array.isArray(device.channels)) {
            return device.channels;
        } else {
            console.warn('Unexpected device.channels format:', device.channels);
            return [];
        }
    }
    
    updateSelection(selectedDevices, patchedDevices) {
        console.log('Updating grid selection display');
        
        // Remove all selection styling
        document.querySelectorAll('.dmx-address, .device-name-label').forEach(element => {
            element.classList.remove('selected');
            element.style.backgroundColor = '';
            element.style.color = '';
            element.style.borderColor = '';
            element.style.boxShadow = '';
            element.style.transform = '';
            element.style.zIndex = '';
        });
        
        if (selectedDevices.length === 0) return;
        
        // Add selection styling to selected devices
        selectedDevices.forEach(patchId => {
            const patch = patchedDevices.find(p => p.id === patchId);
            if (patch) {
                this.highlightPatchedDevice(patch);
            }
        });
    }
    
    highlightPatchedDevice(patch) {
        const channels = this.parseDeviceChannels(patch.device);
        const channelCount = channels.length || 1;
        
        // Style all addresses for this device
        for (let i = 0; i < channelCount; i++) {
            const addr = patch.start_address + i;
            const element = document.querySelector(`[data-address="${addr}"]`);
            if (element) {
                element.classList.add('selected');
            }
        }
        
        // Style the device label
        const label = document.querySelector(`[data-device-address="${patch.start_address}"]`);
        if (label) {
            label.classList.add('selected');
        }
    }
    
    // Event handlers (delegate to main manager)
    handleAddressClick(e, address) {
        if (this.eventHandler) {
            this.eventHandler.handleAddressClick(e, address);
        }
    }
    
    handleMouseDown(e, address) {
        if (this.eventHandler) {
            this.eventHandler.handleMouseDown(e, address);
        }
    }
    
    handleMouseUp(e, address) {
        if (this.eventHandler) {
            this.eventHandler.handleMouseUp(e, address);
        }
    }
    
    handleMouseMove(e, address) {
        if (this.eventHandler) {
            this.eventHandler.handleMouseMove(e, address);
        }
    }
    
    handleContextMenu(e, address) {
        if (this.eventHandler) {
            this.eventHandler.handleContextMenu(e, address);
        }
    }
    
    handleGlobalMouseUp() {
        if (this.eventHandler) {
            this.eventHandler.handleGlobalMouseUp();
        }
    }
    
    handleKeyDown(e) {
        if (this.eventHandler) {
            this.eventHandler.handleKeyDown(e);
        }
    }
    
    setEventHandler(handler) {
        this.eventHandler = handler;
    }
}

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
    }
    
    initialize() {
        this.planView = document.getElementById('planView');
        this.planViewContent = document.getElementById('planViewContent');
        if (!this.planView || !this.planViewContent) return;
        
        this.planViewRect = this.planView.getBoundingClientRect();
        
        this.initializeGrid();
        this.initializeZoomPan();
        
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
        fixture.addEventListener('click', () => this.showDeviceInfo(patch));
        fixture.addEventListener('mousedown', (e) => this.startDragFixture(e, patch));
        
        this.planViewContent.appendChild(fixture);
    }
    
    startDragFixture(e, patch) {
        e.preventDefault();
        const fixture = e.target;
        
        this.isDraggingFixture = true;
        this.draggedFixture = fixture;
        fixture.classList.add('dragging');
        
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
            fixture.classList.add('snapped');
        } else {
            fixture.classList.remove('snapped');
        }
        
        fixture.style.left = `${centerX + x}px`;
        fixture.style.top = `${centerY + y}px`;
    }
    
    async handleFixtureDragEnd(e, patch, onMouseMove, onMouseUp) {
        if (!this.isDraggingFixture) return;
        
        this.isDraggingFixture = false;
        this.draggedFixture.classList.remove('dragging', 'snapped');
        
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
        
        try {
            const response = await PatchAPI.updatePatchPosition(patch.id, x, y);
            if (response.success) {
                patch.x_position = x;
                patch.y_position = y;
            } else {
                this.updateView([patch]); // Revert on error
                this.showNotification('Error updating position: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('Error updating position:', error);
            this.updateView([patch]); // Revert on error
            this.showNotification('Error updating position', 'error');
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
}

/**
 * Main patch manager that coordinates all components
 */
class PatchManager {
    constructor() {
        this.patchedDevices = [];
        this.selectedPatch = null;
        
        // Initialize component managers
        this.selectionManager = new DeviceSelectionManager();
        this.gridManager = new DMXGridManager(this.selectionManager);
        this.planViewController = new PlanViewController();
        
        // Set up event delegation
        this.gridManager.setEventHandler(this);
        this.planViewController.setEventHandler(this);
        
        // Don't auto-init from constructor, let the bottom script handle it
    }
    
    // Helper method to safely parse device channels
    parseDeviceChannels(device) {
        return this.gridManager.parseDeviceChannels(device);
    }
    
    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initializeComponents();
            });
        } else {
            this.initializeComponents();
        }
    }
    
    initializeComponents() {
        console.log('Initializing patch components...');
        this.loadPatchedDevices();
        console.log('Loaded patched devices:', this.patchedDevices.length);
        this.gridManager.generateGrid();
        console.log('DMX grid generated');
        this.updatePatchDisplay();
        console.log('Patch display updated');
        this.planViewController.initialize();
        console.log('Plan view initialized');
        this.setupEventListeners();
        console.log('Event listeners set up');
        console.log('Patch components initialized');
    }
    
    loadPatchedDevices() {
        // Get patched devices from the template data
        if (typeof patchedDevices !== 'undefined') {
            this.patchedDevices = patchedDevices;
        }
    }
    
    // Delegated to gridManager
    generateDMXGrid() {
        this.gridManager.generateGrid();
    }
    
    updatePatchDisplay() {
        this.gridManager.updateDisplay(this.patchedDevices);
        this.planViewController.updateView(this.patchedDevices);
    }
    
    // Delegated to gridManager
    createDeviceLabel(firstAddressElement, deviceName, channelCount) {
        this.gridManager.createDeviceLabel(firstAddressElement, deviceName, channelCount);
    }
    
    // Delegated to gridManager
    createSingleRowLabel(dmxGrid, firstAddressElement, deviceName, channelsInThisRow, totalChannels, originalStartAddress) {
        this.gridManager.createSingleRowLabel(dmxGrid, firstAddressElement, deviceName, channelsInThisRow, totalChannels, originalStartAddress);
    }
    
    // Delegated to planViewController
    initializePlanView() {
        this.planViewController.initialize();
    }
    
    // Delegated to planViewController
    updatePlanView() {
        this.planViewController.updateView(this.patchedDevices);
    }
    
    showAddressInfo(address) {
        const patch = this.patchedDevices.find(p => {
            const channels = this.parseDeviceChannels(p.device);
            const channelCount = channels.length || 1;
            return address >= p.start_address && address < p.start_address + channelCount;
        });
        
        if (patch) {
            this.showDeviceInfo(patch);
        } else {
            alert(`DMX Address ${address} is not patched to any device`);
        }
    }
    
    showDeviceInfo(patch) {
        this.selectedPatch = patch;
        const device = patch.device;
        const channels = this.parseDeviceChannels(device);
        
        let x = patch.x_position || 0;
        let y = patch.y_position || 0;
        
        // Convert from percentage to pixels if needed
        if (x <= 100 && y <= 100 && x >= 0 && y >= 0) {
            const rect = this.planView.getBoundingClientRect();
            x = (x - 50) * (rect.width / 100);
            y = (y - 50) * (rect.height / 100);
        }
        
        const content = `
            <h6>${device.name}</h6>
            <p><strong>Start Address:</strong> ${patch.start_address}</p>
            <p><strong>Channels:</strong> ${channels.length}</p>
            <p><strong>Position:</strong> X: ${Math.round(x)}px, Y: ${Math.round(y)}px</p>
            <h6>Channel Configuration:</h6>
            <div class="channel-list">
                ${channels.map((ch, i) => `
                    <div class="d-flex justify-content-between align-items-center p-2 border-bottom">
                        <span>Ch ${i + 1} (${patch.start_address + i})</span>
                        <span class="badge" style="background-color: ${this.getChannelTypeColor(ch.type)}">${ch.type}</span>
                    </div>
                `).join('')}
            </div>
        `;
        
        const deviceInfoContent = document.getElementById('deviceInfoContent');
        if (deviceInfoContent) {
            deviceInfoContent.innerHTML = content;
            const modal = new bootstrap.Modal(document.getElementById('deviceInfoModal'));
            modal.show();
        }
    }
    
    getChannelTypeColor(type) {
        const colors = {
            'dimmer_channel': '#ffc107',
            'dimmer_fine': '#ffc107',
            'red_channel': '#dc3545',
            'green_channel': '#28a745',
            'blue_channel': '#007bff',
            'white_channel': '#f8f9fa',
            'pan_fine': '#17a2b8',
            'tilt_fine': '#6f42c1',
            'gobo1': '#fd7e14',
            'gobo2': '#fd7e14',
            'gobo_rotation': '#fd7e14',
            'gobo_rotation_fine': '#fd7e14',
            'color_wheel': '#e83e8c',
            'prisma_rotation': '#795548',
            'zoom_fine': '#607d8b',
            'focus_fine': '#3f51b5',
            'special_functions': '#ff5722',
            'dummy': '#6c757d'
        };
        return colors[type] || '#6c757d';
    }
    
    editDevicePosition() {
        if (!this.selectedPatch) return;
        
        const positionX = document.getElementById('positionX');
        const positionY = document.getElementById('positionY');
        
        if (positionX && positionY) {
            let x = this.selectedPatch.x_position || 0;
            let y = this.selectedPatch.y_position || 0;
            
            // Convert from percentage to pixels if needed
            if (x <= 100 && y <= 100 && x >= 0 && y >= 0) {
                const rect = this.planViewController.planView?.getBoundingClientRect();
                if (rect) {
                    x = (x - 50) * (rect.width / 100);
                    y = (y - 50) * (rect.height / 100);
                }
            }
            
            positionX.value = Math.round(x);
            positionY.value = Math.round(y);
            
            const modal = new bootstrap.Modal(document.getElementById('positionModal'));
            modal.show();
        }
    }
    
    async savePosition() {
        if (!this.selectedPatch) return;
        
        const positionX = document.getElementById('positionX');
        const positionY = document.getElementById('positionY');
        
        if (!positionX || !positionY) return;
        
        let x = parseFloat(positionX.value) || 0;
        let y = parseFloat(positionY.value) || 0;
        
        // Snap to grid if enabled
        if (this.planViewController.snapToGrid && this.planViewController.gridEnabled) {
            x = Math.round(x / this.planViewController.gridSize) * this.planViewController.gridSize;
            y = Math.round(y / this.planViewController.gridSize) * this.planViewController.gridSize;
        }
        
        try {
            const response = await PatchAPI.updatePatchPosition(this.selectedPatch.id, x, y);
            if (response.success) {
                this.selectedPatch.x_position = x;
                this.selectedPatch.y_position = y;
                this.updatePlanView();
                bootstrap.Modal.getInstance(document.getElementById('positionModal')).hide();
                this.showNotification('Position updated successfully', 'success');
            } else {
                this.showNotification('Error updating position: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('Error updating position:', error);
            this.showNotification('Error updating position', 'error');
        }
    }
    
    // Delegated to planViewController
    startDragFixture(e, patch) {
        this.planViewController.startDragFixture(e, patch);
    }

    // Grid functionality delegated to planViewController
    
    toggleGrid() {
        this.planViewController.toggleGrid();
    }
    
    // Zoom and pan functionality delegated to planViewController
    
    zoomToFit() {
        this.planViewController.zoomToFit(this.patchedDevices);
    }
    
    
    setupEventListeners() {
        // Drag and drop for device patching
        document.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('device-item')) {
                e.dataTransfer.setData('device-id', e.target.dataset.deviceId);
                e.target.classList.add('dragging');
            }
        });
        
        document.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('device-item')) {
                e.target.classList.remove('dragging');
            }
        });
        
        document.addEventListener('dragover', (e) => {
            if (e.target.classList.contains('dmx-address')) {
                e.preventDefault();
                e.target.classList.add('drag-over');
            }
        });
        
        document.addEventListener('dragleave', (e) => {
            if (e.target.classList.contains('dmx-address')) {
                e.target.classList.remove('drag-over');
            }
        });
        
        document.addEventListener('drop', (e) => {
            if (e.target.classList.contains('dmx-address')) {
                e.preventDefault();
                e.target.classList.remove('drag-over');
                
                const deviceId = e.dataTransfer.getData('device-id');
                const address = parseInt(e.target.dataset.address);
                
                if (deviceId) {
                    this.patchDevice(deviceId, address);
                }
            }
        });
    }
    
    async patchDevice(deviceId, startAddress) {
        console.log(`Patching device ${deviceId} to address ${startAddress}`);
        
        try {
            const response = await PatchAPI.patchDevice(deviceId, startAddress);
            if (response.success) {
                await this.refreshPatchedDevices();
                this.showNotification('Device patched successfully', 'success');
            } else {
                this.showNotification('Error patching device: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('Error patching device:', error);
            this.showNotification('Error patching device', 'error');
        }
    }
    
    async unpatchDevice(patchId) {
        if (confirm('Are you sure you want to unpatch this device?')) {
            try {
                const response = await PatchAPI.unpatchDevice(patchId);
                if (response.success) {
                    await this.refreshPatchedDevices();
                    this.showNotification('Device unpatched successfully', 'success');
                } else {
                    this.showNotification('Error unpatching device: ' + response.error, 'error');
                }
            } catch (error) {
                console.error('Error unpatching device:', error);
                this.showNotification('Error unpatching device', 'error');
            }
        }
    }
    
    async clearAllPatch() {
        if (confirm('Are you sure you want to clear all patched devices?')) {
            try {
                const response = await PatchAPI.clearAllPatch();
                if (response.success) {
                    await this.refreshPatchedDevices();
                    this.showNotification('Patch cleared successfully', 'success');
                } else {
                    this.showNotification('Error clearing patch: ' + response.error, 'error');
                }
            } catch (error) {
                console.error('Error clearing patch:', error);
                this.showNotification('Error clearing patch', 'error');
            }
        }
    }
    
    async exportPatch() {
        try {
            const response = await PatchAPI.exportPatch();
            if (response.success) {
                const blob = new Blob([JSON.stringify(response.data, null, 2)], 
                    { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'dmx_patch.json';
                a.click();
                URL.revokeObjectURL(url);
                this.showNotification('Patch exported successfully', 'success');
            } else {
                this.showNotification('Error exporting patch: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('Error exporting patch:', error);
            this.showNotification('Error exporting patch', 'error');
        }
    }
    
    // Utility methods (API calls delegated to PatchAPI)
    
    showNotification(message, type = 'info') {
        // Use DMXUtils if available, otherwise fallback to alert
        if (typeof DMXUtils !== 'undefined' && DMXUtils.showNotification) {
            DMXUtils.showNotification(message, type);
        } else {
            alert(message);
        }
    }
    
    // === NEW DRAG & DROP AND MULTI-SELECT FUNCTIONALITY ===
    
    handleAddressClick(e, address) {
        console.log('handleAddressClick called with address:', address);
        const patch = this.getPatchAtAddress(address);
        
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        if (e.ctrlKey || e.metaKey) {
            // Multi-select with Ctrl/Cmd key
            if (patch) {
                this.selectionManager.toggleDevice(patch.id);
                this.updateDeviceSelection();
            }
        } else if (e.shiftKey && patch) {
            // Shift-click for range selection
            if (this.selectionManager.hasSelection()) {
                const selectedDevices = this.selectionManager.getSelectedDevices();
                const lastSelected = selectedDevices[selectedDevices.length - 1];
                const lastPatch = this.patchedDevices.find(p => p.id === lastSelected);
                if (lastPatch) {
                    this.selectionManager.selectRange(lastPatch, patch, this.patchedDevices);
                    this.updateDeviceSelection();
                }
            } else {
                this.selectionManager.clearSelection();
                this.selectionManager.selectDevice(patch.id);
                this.updateDeviceSelection();
            }
        } else {
            // Regular click
            if (patch) {
                this.selectionManager.clearSelection();
                this.selectionManager.selectDevice(patch.id);
                this.updateDeviceSelection();
                this.showAddressInfo(address);
            } else {
                this.selectionManager.clearSelection();
                this.updateDeviceSelection();
            }
        }
    }
    
    handleMouseDown(e, address) {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            return;
        }
        
        if (e.button === 0) {
            const patch = this.getPatchAtAddress(address);
            if (patch) {
                // If clicked device is not selected, select only it
                if (!this.selectionManager.isSelected(patch.id)) {
                    this.selectionManager.clearSelection();
                    this.selectionManager.selectDevice(patch.id);
                    this.updateDeviceSelection();
                }
                
                this.selectionManager.startDrag(address);
                e.preventDefault();
            }
        }
    }
    
    handleMouseUp(e, address) {
        if (this.selectionManager.isDraggingActive() && e.button === 0) {
            const targetAddress = parseInt(address);
            
            if (this.selectionManager.dragStartAddress !== targetAddress) {
                this.moveSelectedDevices(targetAddress);
            }
            
            this.stopDragging();
        }
    }
    
    handleMouseMove(e, address) {
        if (this.selectionManager.isDraggingActive()) {
            const element = e.target;
            if (this.canDropAtAddress(parseInt(address))) {
                element.style.backgroundColor = '#28a745';
            } else {
                element.style.backgroundColor = '#dc3545';
            }
        }
    }
    
    handleContextMenu(e, address) {
        e.preventDefault();
        const patch = this.getPatchAtAddress(address);
        
        if (patch) {
            // If right-clicked device is not selected, select only it
            if (!this.selectionManager.isSelected(patch.id)) {
                this.selectionManager.clearSelection();
                this.selectionManager.selectDevice(patch.id);
                this.updateDeviceSelection();
            }
            
            this.showContextMenu(e.clientX, e.clientY);
        }
    }
    
    handleGlobalMouseUp() {
        if (this.selectionManager.isDraggingActive()) {
            this.stopDragging();
        }
        this.hideContextMenu();
    }
    
    handleKeyDown(e) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.selectionManager.hasSelection()) {
                this.removeSelectedDevices();
            }
        } else if (e.key === 'Escape') {
            this.selectionManager.clearSelection();
            this.updateDeviceSelection();
            this.hideContextMenu();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            this.selectAllDevices();
        }
    }
    
    // === HELPER METHODS ===
    
    async refreshPatchedDevices() {
        console.log('Refreshing patched devices data...');
        
        try {
            const response = await PatchAPI.getPatchedDevices();
            if (Array.isArray(response)) {
                this.patchedDevices = response;
                console.log('Updated patched devices:', this.patchedDevices.length);
                
                this.selectionManager.clearSelection();
                this.updatePatchDisplay();
                
                console.log('Patch display refreshed successfully');
            } else {
                console.error('Invalid response format for patched devices:', response);
                this.showNotification('Error refreshing patch data', 'error');
            }
        } catch (error) {
            console.error('Error refreshing patched devices:', error);
            this.showNotification('Error refreshing patch data', 'error');
        }
    }
    
    getPatchAtAddress(address) {
        console.log('getPatchAtAddress called with:', address, 'patchedDevices:', this.patchedDevices.length);
        const result = this.patchedDevices.find(patch => {
            const channels = this.parseDeviceChannels(patch.device);
            const channelCount = channels.length || 1;
            const matches = address >= patch.start_address && address < patch.start_address + channelCount;
            console.log(`Checking patch ${patch.device.name} at ${patch.start_address}-${patch.start_address + channelCount - 1}:`, matches);
            return matches;
        });
        console.log('getPatchAtAddress result:', result);
        return result;
    }
    
    updateDeviceSelection() {
        const selectedDevices = this.selectionManager.getSelectedDevices();
        this.gridManager.updateSelection(selectedDevices, this.patchedDevices);
    }
    
    canDropAtAddress(targetAddress) {
        const selectedDevices = this.selectionManager.getSelectedDevices();
        
        return selectedDevices.every(patchId => {
            const patch = this.patchedDevices.find(p => p.id === patchId);
            if (!patch) return false;
            
            const channels = this.parseDeviceChannels(patch.device);
            const channelCount = channels.length || 1;
            const offset = targetAddress - patch.start_address;
            const newStart = patch.start_address + offset;
            
            // Check address bounds
            if (newStart < 1 || newStart + channelCount - 1 > 512) {
                return false;
            }
            
            // Check for conflicts with other devices
            for (let i = 0; i < channelCount; i++) {
                const checkAddr = newStart + i;
                const conflictPatch = this.patchedDevices.find(p => {
                    if (selectedDevices.includes(p.id)) return false;
                    const conflictChannels = this.parseDeviceChannels(p.device);
                    const conflictCount = conflictChannels.length || 1;
                    return checkAddr >= p.start_address && checkAddr < p.start_address + conflictCount;
                });
                
                if (conflictPatch) return false;
            }
            
            return true;
        });
    }
    
    async moveSelectedDevices(targetAddress) {
        const selectedDevices = this.selectionManager.getSelectedDevices();
        if (selectedDevices.length === 0) return;
        
        const firstPatch = this.patchedDevices.find(p => selectedDevices.includes(p.id));
        if (!firstPatch) return;
        
        const offset = targetAddress - firstPatch.start_address;
        
        try {
            const movePromises = selectedDevices.map(patchId => {
                const patch = this.patchedDevices.find(p => p.id === patchId);
                if (patch) {
                    const newAddress = patch.start_address + offset;
                    return PatchAPI.updatePatchAddress(patch.id, newAddress);
                }
            }).filter(Boolean);
            
            await Promise.all(movePromises);
            await this.refreshPatchedDevices();
            this.showNotification('Devices moved successfully', 'success');
        } catch (error) {
            console.error('Error moving devices:', error);
            this.showNotification('Error moving devices', 'error');
        }
    }
    
    showContextMenu(x, y) {
        this.hideContextMenu();
        
        const menu = document.createElement('div');
        menu.id = 'contextMenu';
        menu.className = 'context-menu';
        menu.style.position = 'fixed';
        menu.style.top = `${y}px`;
        menu.style.left = `${x}px`;
        
        const selectedCount = this.selectionManager.getSelectionCount();
        const menuItems = [
            {
                text: `Remove ${selectedCount} device${selectedCount > 1 ? 's' : ''}`,
                action: () => this.removeSelectedDevices()
            }
        ];
        
        menuItems.forEach((item, index) => {
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            if (index === menuItems.length - 1) {
                menuItem.classList.add('last-item');
            }
            menuItem.textContent = item.text;
            
            let actionTriggered = false;
            
            menuItem.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (!actionTriggered) {
                    actionTriggered = true;
                    setTimeout(() => {
                        item.action();
                        this.hideContextMenu();
                    }, 10);
                }
            });
            
            menu.appendChild(menuItem);
        });
        
        document.body.appendChild(menu);
        
        setTimeout(() => {
            const hideHandler = (e) => {
                if (!menu.contains(e.target)) {
                    this.hideContextMenu();
                }
            };
            document.addEventListener('click', hideHandler, { once: true });
        }, 200);
    }
    
    hideContextMenu() {
        console.log('hideContextMenu called');
        const menu = document.getElementById('contextMenu');
        if (menu) {
            console.log('Removing context menu');
            menu.remove();
        } else {
            console.log('No context menu found to remove');
        }
    }
    
    async removeSelectedDevices() {
        if (!this.selectionManager.hasSelection()) return;
        
        const selectedCount = this.selectionManager.getSelectionCount();
        
        if (confirm(`Are you sure you want to remove ${selectedCount} device${selectedCount > 1 ? 's' : ''}?`)) {
            try {
                const removePromises = this.selectionManager.getSelectedDevices().map(patchId => 
                    PatchAPI.unpatchDevice(patchId)
                );
                
                await Promise.all(removePromises);
                this.selectionManager.clearSelection();
                await this.refreshPatchedDevices();
                this.showNotification('Devices removed successfully', 'success');
            } catch (error) {
                console.error('Error removing devices:', error);
                this.showNotification('Error removing devices', 'error');
            }
        }
    }
    
    selectAllDevices() {
        this.selectionManager.selectAll(this.patchedDevices);
        this.updateDeviceSelection();
    }
    
    stopDragging() {
        this.selectionManager.stopDrag();
        
        // Reset all address background colors
        document.querySelectorAll('.dmx-address').forEach(addr => {
            addr.style.backgroundColor = '';
        });
    }
    
    // Delegated to PatchAPI
    async updatePatchAddress(patchId, newAddress) {
        return PatchAPI.updatePatchAddress(patchId, newAddress);
    }
}

// Global functions for backward compatibility
let patchManager;

// Initialize immediately if DOM is ready, otherwise wait
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM loaded, creating PatchManager...');
        patchManager = new PatchManager();
        window.patchManager = patchManager; // Make globally available
        patchManager.init();
    });
} else {
    console.log('DOM already ready, creating PatchManager...');
    patchManager = new PatchManager();
    window.patchManager = patchManager; // Make globally available
    patchManager.init();
}

// Global functions that the HTML template expects
function unpatchDevice(patchId) {
    if (patchManager) {
        patchManager.unpatchDevice(patchId);
    }
}

function clearAllPatch() {
    if (patchManager) {
        patchManager.clearAllPatch();
    }
}

function exportPatch() {
    if (patchManager) {
        patchManager.exportPatch();
    }
}

function editDevicePosition() {
    if (patchManager) {
        patchManager.editDevicePosition();
    }
}

function savePosition() {
    if (patchManager) {
        patchManager.savePosition();
    }
}

function toggleGrid() {
    if (patchManager) {
        patchManager.toggleGrid();
    }
}

function zoomToFit() {
    if (patchManager) {
        patchManager.zoomToFit();
    }
}