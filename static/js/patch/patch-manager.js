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
        this.planViewController.initialize();
        console.log('Plan view initialized');
        this.updatePatchDisplay();
        console.log('Patch display updated');
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
    
    updatePatchDisplay() {
        this.gridManager.updateDisplay(this.patchedDevices);
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
                this.planViewController.updateView(this.patchedDevices);
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
    
    toggleGrid() {
        this.planViewController.toggleGrid();
    }
    
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
    
    showNotification(message, type = 'info') {
        // Use DMXUtils if available, otherwise fallback to alert
        if (typeof DMXUtils !== 'undefined' && DMXUtils.showNotification) {
            DMXUtils.showNotification(message, type);
        } else {
            alert(message);
        }
    }
    
    // === EVENT HANDLERS FOR GRID AND PLAN VIEW ===
    
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

    // === DEFAULT VALUES MANAGEMENT ===

    editDefaultValues() {
        if (!this.selectedPatch) return;

        const device = this.selectedPatch.device;
        const channels = this.parseDeviceChannels(device);
        const defaultValues = device.default_values ? JSON.parse(device.default_values) : [];

        const content = document.getElementById('defaultValuesContent');
        if (!content) return;

        let html = '';
        channels.forEach((ch, i) => {
            const currentValue = defaultValues[i] !== undefined ? defaultValues[i] : 0;
            const dmxAddress = this.selectedPatch.start_address + i;

            html += `
                <div class="mb-3">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <label class="form-label mb-0">
                            <span class="badge" style="background-color: ${this.getChannelTypeColor(ch.type)}">${ch.type}</span>
                            Ch ${i + 1} (DMX ${dmxAddress})
                        </label>
                        <span class="badge bg-secondary" id="defaultValue_${i}">Value: ${currentValue}</span>
                    </div>
                    <input type="range"
                           class="form-range default-value-slider"
                           id="slider_${i}"
                           min="0"
                           max="255"
                           value="${currentValue}"
                           data-channel-index="${i}"
                           oninput="updateDefaultValueDisplay(${i}, this.value)">
                </div>
            `;
        });

        content.innerHTML = html;

        const modal = new bootstrap.Modal(document.getElementById('defaultValuesModal'));
        modal.show();
    }

    updateDefaultValueDisplay(channelIndex, value) {
        const badge = document.getElementById(`defaultValue_${channelIndex}`);
        if (badge) {
            badge.textContent = `Value: ${value}`;
        }
    }

    resetDefaultValues() {
        if (!this.selectedPatch) return;

        const device = this.selectedPatch.device;
        const channels = this.parseDeviceChannels(device);

        channels.forEach((_, i) => {
            const slider = document.getElementById(`slider_${i}`);
            if (slider) {
                slider.value = 0;
                this.updateDefaultValueDisplay(i, 0);
            }
        });
    }

    async saveDefaultValues() {
        if (!this.selectedPatch) return;

        const device = this.selectedPatch.device;
        const channels = this.parseDeviceChannels(device);
        const defaultValues = [];

        for (let i = 0; i < channels.length; i++) {
            const slider = document.getElementById(`slider_${i}`);
            if (slider) {
                defaultValues.push(parseInt(slider.value));
            } else {
                defaultValues.push(0);
            }
        }

        try {
            const response = await PatchAPI.updateDeviceDefaultValues(device, defaultValues);
            if (response.success) {
                // Update the local device data
                device.default_values = JSON.stringify(defaultValues);

                bootstrap.Modal.getInstance(document.getElementById('defaultValuesModal')).hide();
                this.showNotification('Default values saved successfully', 'success');

                // Apply the default values to the fixtures immediately (if no playback is active)
                try {
                    const applyResponse = await PatchAPI.applyDefaultValues();
                    if (applyResponse.success) {
                        console.log('[DMX] Default values applied to fixtures');
                    } else {
                        console.log('[DMX] Could not apply defaults:', applyResponse.message);
                    }
                } catch (applyError) {
                    console.error('[DMX] Error applying defaults:', applyError);
                }

                // Refresh the patched devices to ensure we have the latest data
                await this.refreshPatchedDevices();
            } else {
                this.showNotification('Error saving default values: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('Error saving default values:', error);
            this.showNotification('Error saving default values', 'error');
        }
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

function editDefaultValues() {
    if (patchManager) {
        patchManager.editDefaultValues();
    }
}

function updateDefaultValueDisplay(channelIndex, value) {
    if (patchManager) {
        patchManager.updateDefaultValueDisplay(channelIndex, value);
    }
}

function resetDefaultValues() {
    if (patchManager) {
        patchManager.resetDefaultValues();
    }
}

function saveDefaultValues() {
    if (patchManager) {
        patchManager.saveDefaultValues();
    }
}