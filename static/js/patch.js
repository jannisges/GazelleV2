/**
 * Patch Management for DMX Lighting Control
 * Handles device patching, visual display, and 2D plan view
 */

class PatchManager {
    constructor() {
        this.dmxData = {};
        this.patchedDevices = [];
        this.selectedPatch = null;
        this.planViewRect = null;
        this.addressesPerRow = 16;
        this.selectedDevices = new Set(); // Track selected devices for multi-select
        this.isDragging = false;
        this.dragStartAddress = null;
        this.globalListenersAdded = false;
        
        // Don't auto-init from constructor, let the bottom script handle it
    }
    
    // Helper method to safely parse device channels
    parseDeviceChannels(device) {
        if (!device.channels) return [];
        
        if (typeof device.channels === 'string') {
            try {
                return JSON.parse(device.channels);
            } catch (e) {
                console.error('Error parsing device channels JSON:', e, 'Raw data:', device.channels);
                return [];
            }
        } else if (Array.isArray(device.channels)) {
            return device.channels;
        } else {
            console.warn('Unexpected device.channels format:', device.channels);
            return [];
        }
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
        this.generateDMXGrid();
        console.log('DMX grid generated');
        this.updatePatchDisplay();
        console.log('Patch display updated');
        this.initializePlanView();
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
    
    generateDMXGrid() {
        const grid = document.getElementById('dmxGrid');
        if (!grid) {
            console.error('DMX Grid element not found!');
            return;
        }
        
        console.log('Found DMX grid element, generating addresses...');
        grid.innerHTML = '';
        
        for (let i = 1; i <= 512; i++) {
            const address = document.createElement('div');
            address.className = 'dmx-address';
            address.dataset.address = i;
            address.textContent = i;
            
            // Enhanced event listeners for patched device interaction
            address.addEventListener('click', (e) => {
                console.log('Address clicked:', i);
                this.handleAddressClick(e, i);
            });
            address.addEventListener('mousedown', (e) => {
                console.log('Mouse down on address:', i);
                this.handleMouseDown(e, i);
            });
            address.addEventListener('mouseup', (e) => {
                console.log('Mouse up on address:', i);
                this.handleMouseUp(e, i);
            });
            address.addEventListener('mousemove', (e) => {
                if (this.isDragging) {
                    this.handleMouseMove(e, i);
                }
            });
            address.addEventListener('contextmenu', (e) => {
                console.log('Context menu on address:', i);
                this.handleContextMenu(e, i);
            });
            
            grid.appendChild(address);
        }
        
        // Add global event listeners for drag operations (only if not already added)
        if (!this.globalListenersAdded) {
            document.addEventListener('mouseup', () => this.handleGlobalMouseUp());
            document.addEventListener('keydown', (e) => this.handleKeyDown(e));
            this.globalListenersAdded = true;
        }
        
        console.log(`DMX Grid generated with 512 addresses. Grid children count: ${grid.children.length}`);
    }
    
    updatePatchDisplay() {
        console.log('Updating patch display with', this.patchedDevices.length, 'patched devices');
        
        // Clear current display
        document.querySelectorAll('.dmx-address').forEach(addr => {
            addr.className = 'dmx-address';
            addr.removeAttribute('data-device-name');
            addr.textContent = addr.dataset.address; // Reset to show address number
        });
        
        // Remove existing device name labels
        document.querySelectorAll('.device-name-label').forEach(label => {
            label.remove();
        });
        
        // Update with patched devices
        this.patchedDevices.forEach(patch => {
            const device = patch.device;
            const channels = this.parseDeviceChannels(device);
            const channelCount = channels.length || 1;
            
            console.log(`Processing device: ${device.name}, channels: ${channelCount}, start: ${patch.start_address}`);
            
            // Mark addresses as occupied
            for (let i = 0; i < channelCount; i++) {
                const address = patch.start_address + i;
                const element = document.querySelector(`[data-address="${address}"]`);
                if (element) {
                    if (i === 0) {
                        element.classList.add('occupied', 'device-start');
                        element.title = `${device.name} (Start)`;
                        element.setAttribute('data-device-name', device.name);
                        
                        // Create device name label that appears before this address
                        console.log(`Calling createDeviceLabel for ${device.name} at address ${address}`);
                        this.createDeviceLabel(element, device.name, channelCount);
                    } else {
                        element.classList.add('partial');
                        element.title = `${device.name} (Ch ${i + 1})`;
                    }
                }
            }
        });
        
        this.updatePlanView();
    }
    
    createDeviceLabel(firstAddressElement, deviceName, channelCount) {
        console.log(`createDeviceLabel called for ${deviceName}, channels: ${channelCount}`);
        const dmxGrid = document.getElementById('dmxGrid');
        if (!dmxGrid) {
            console.log('DMX Grid not found in createDeviceLabel');
            return;
        }
        console.log('DMX Grid found, proceeding with label creation');
        
        // Wait a moment for the grid to be fully rendered
        setTimeout(() => {
            // Create device name label that looks like a DMX address box
            const label = document.createElement('div');
            label.className = 'device-name-label';
            label.textContent = deviceName;
            label.title = `${deviceName} (${channelCount} channels)`;
            label.dataset.deviceAddress = firstAddressElement.dataset.address;
            
            // Position the label absolutely above the first address element
            const gridRect = dmxGrid.getBoundingClientRect();
            const addressRect = firstAddressElement.getBoundingClientRect();
            
            // Calculate position relative to the grid
            const left = addressRect.left - gridRect.left;
            const top = addressRect.top - gridRect.top;
            
            // Calculate width to span all channels
            // Each DMX address box is 40px wide + 2px gap after it (except the last one)
            const boxWidth = 40; // Width of each box
            const gapWidth = 2; // Gap between boxes
            const labelWidth = (channelCount * boxWidth) + ((channelCount - 1) * gapWidth);
            
            label.style.position = 'absolute';
            label.style.left = `${left}px`;
            label.style.top = `${top}px`;
            label.style.width = `${labelWidth}px`;
            label.style.zIndex = '10';
            label.style.cursor = 'pointer';
            
            // Add event listeners to the device label
            const startAddress = parseInt(firstAddressElement.dataset.address);
            console.log(`Adding event listeners to device label ${deviceName} at address ${startAddress}`);
            
            label.addEventListener('click', (e) => {
                console.log('Device label clicked:', deviceName);
                this.handleAddressClick(e, startAddress);
            });
            label.addEventListener('mousedown', (e) => {
                console.log('Mouse down on device label:', deviceName);
                this.handleMouseDown(e, startAddress);
            });
            label.addEventListener('mouseup', (e) => {
                console.log('Mouse up on device label:', deviceName);
                this.handleMouseUp(e, startAddress);
            });
            label.addEventListener('contextmenu', (e) => {
                console.log('Context menu on device label:', deviceName);
                this.handleContextMenu(e, startAddress);
            });
            
            console.log(`Event listeners added to device label ${deviceName}`);
            
            // Add to grid
            dmxGrid.appendChild(label);
            
            console.log(`Created device label: ${deviceName} above address ${firstAddressElement.dataset.address} at position ${left}, ${top}, width: ${labelWidth}px for ${channelCount} channels`);
        }, 50);
    }
    
    initializePlanView() {
        const planView = document.getElementById('planView');
        if (!planView) return;
        
        this.planViewRect = planView.getBoundingClientRect();
        
        // Update rect on window resize
        window.addEventListener('resize', () => {
            this.planViewRect = planView.getBoundingClientRect();
            this.updatePatchDisplay(); // Recalculate positions
        });
        
        this.updatePlanView();
    }
    
    updatePlanView() {
        const planView = document.getElementById('planView');
        if (!planView) return;
        
        // Clear existing fixtures
        planView.querySelectorAll('.plan-fixture').forEach(f => f.remove());
        
        // Add patched devices
        this.patchedDevices.forEach(patch => {
            const fixture = document.createElement('div');
            fixture.className = 'plan-fixture';
            fixture.dataset.patchId = patch.id;
            fixture.textContent = patch.start_address;
            fixture.title = patch.device.name;
            
            // Position fixture
            const x = patch.x_position || 50;
            const y = patch.y_position || 50;
            fixture.style.left = `${x}%`;
            fixture.style.top = `${y}%`;
            
            // Add event listeners
            fixture.addEventListener('click', () => this.showDeviceInfo(patch));
            fixture.addEventListener('mousedown', (e) => this.startDragFixture(e, patch));
            
            planView.appendChild(fixture);
        });
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
        
        const content = `
            <h6>${device.name}</h6>
            <p><strong>Start Address:</strong> ${patch.start_address}</p>
            <p><strong>Channels:</strong> ${channels.length}</p>
            <p><strong>Position:</strong> X: ${patch.x_position || 50}%, Y: ${patch.y_position || 50}%</p>
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
            // Old format (short names)
            'dimmer': '#ffc107',
            'red': '#dc3545',
            'green': '#28a745',
            'blue': '#007bff',
            'white': '#f8f9fa',
            'amber': '#ffc107',
            'uv': '#6f42c1',
            'pan': '#17a2b8',
            'tilt': '#6f42c1',
            'focus': '#3f51b5',
            'zoom': '#607d8b',
            'gobo': '#fd7e14',
            'color': '#e83e8c',
            'speed': '#343a40',
            'strobe': '#20c997',
            'macro': '#9c27b0',
            'prism': '#795548',
            'frost': '#9e9e9e',
            'reset': '#f44336',
            // New format (full names)
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
            positionX.value = this.selectedPatch.x_position || 50;
            positionY.value = this.selectedPatch.y_position || 50;
            
            const modal = new bootstrap.Modal(document.getElementById('positionModal'));
            modal.show();
        }
    }
    
    savePosition() {
        if (!this.selectedPatch) return;
        
        const positionX = document.getElementById('positionX');
        const positionY = document.getElementById('positionY');
        
        if (!positionX || !positionY) return;
        
        const x = parseFloat(positionX.value);
        const y = parseFloat(positionY.value);
        
        this.apiCall('/api/update-patch-position', 'POST', {
            patch_id: this.selectedPatch.id,
            x_position: x,
            y_position: y
        })
        .then(response => {
            if (response.success) {
                this.selectedPatch.x_position = x;
                this.selectedPatch.y_position = y;
                this.updatePlanView();
                bootstrap.Modal.getInstance(document.getElementById('positionModal')).hide();
                this.showNotification('Position updated successfully', 'success');
            } else {
                this.showNotification('Error updating position: ' + response.error, 'error');
            }
        })
        .catch(error => {
            console.error('Error updating position:', error);
            this.showNotification('Error updating position', 'error');
        });
    }
    
    startDragFixture(e, patch) {
        e.preventDefault();
        const fixture = e.target;
        const planView = document.getElementById('planView');
        
        let isDragging = true;
        fixture.classList.add('dragging');
        
        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            const rect = planView.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            
            const clampedX = Math.max(0, Math.min(100, x));
            const clampedY = Math.max(0, Math.min(100, y));
            
            fixture.style.left = `${clampedX}%`;
            fixture.style.top = `${clampedY}%`;
        };
        
        const onMouseUp = (e) => {
            if (!isDragging) return;
            
            isDragging = false;
            fixture.classList.remove('dragging');
            
            const rect = planView.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            
            const clampedX = Math.max(0, Math.min(100, x));
            const clampedY = Math.max(0, Math.min(100, y));
            
            // Save position
            this.apiCall('/api/update-patch-position', 'POST', {
                patch_id: patch.id,
                x_position: clampedX,
                y_position: clampedY
            })
            .then(response => {
                if (response.success) {
                    patch.x_position = clampedX;
                    patch.y_position = clampedY;
                } else {
                    this.updatePlanView(); // Revert on error
                    this.showNotification('Error updating position: ' + response.error, 'error');
                }
            })
            .catch(error => {
                console.error('Error updating position:', error);
                this.updatePlanView(); // Revert on error
                this.showNotification('Error updating position', 'error');
            });
            
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
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
    
    patchDevice(deviceId, startAddress) {
        console.log(`Patching device ${deviceId} to address ${startAddress}`);
        
        this.apiCall('/api/patch-device', 'POST', {
            device_id: parseInt(deviceId),
            start_address: startAddress
        })
        .then(response => {
            if (response.success) {
                // Refresh patched devices without page reload
                this.refreshPatchedDevices();
                this.showNotification('Device patched successfully', 'success');
            } else {
                this.showNotification('Error patching device: ' + response.error, 'error');
            }
        })
        .catch(error => {
            console.error('Error patching device:', error);
            this.showNotification('Error patching device', 'error');
        });
    }
    
    unpatchDevice(patchId) {
        if (confirm('Are you sure you want to unpatch this device?')) {
            this.apiCall('/api/unpatch-device', 'POST', {
                patch_id: patchId
            })
            .then(response => {
                if (response.success) {
                    // Refresh patched devices without page reload
                    this.refreshPatchedDevices();
                    this.showNotification('Device unpatched successfully', 'success');
                } else {
                    this.showNotification('Error unpatching device: ' + response.error, 'error');
                }
            })
            .catch(error => {
                console.error('Error unpatching device:', error);
                this.showNotification('Error unpatching device', 'error');
            });
        }
    }
    
    clearAllPatch() {
        if (confirm('Are you sure you want to clear all patched devices?')) {
            this.apiCall('/api/clear-all-patch', 'POST')
            .then(response => {
                if (response.success) {
                    // Refresh patched devices without page reload
                    this.refreshPatchedDevices();
                    this.showNotification('Patch cleared successfully', 'success');
                } else {
                    this.showNotification('Error clearing patch: ' + response.error, 'error');
                }
            })
            .catch(error => {
                console.error('Error clearing patch:', error);
                this.showNotification('Error clearing patch', 'error');
            });
        }
    }
    
    exportPatch() {
        this.apiCall('/api/export-patch')
        .then(response => {
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
        })
        .catch(error => {
            console.error('Error exporting patch:', error);
            this.showNotification('Error exporting patch', 'error');
        });
    }
    
    // Utility methods
    apiCall(url, method = 'GET', data = null) {
        console.log('apiCall called:', { url, method, data });
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };
        
        if (data) {
            options.body = JSON.stringify(data);
        }
        
        console.log('Fetch options:', options);
        
        return fetch(url, options)
            .then(response => {
                console.log('API response status:', response.status, response.statusText);
                if (!response.ok) {
                    // For HTTP error status codes, still parse JSON but mark as error
                    return response.json().then(errorData => {
                        console.log('API error response:', errorData);
                        return { success: false, error: errorData.error || 'Unknown error' };
                    });
                }
                return response.json();
            })
            .then(result => {
                console.log('API response data:', result);
                return result;
            });
    }
    
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
        console.log('Event details - ctrlKey:', e.ctrlKey, 'metaKey:', e.metaKey, 'shiftKey:', e.shiftKey);
        const patch = this.getPatchAtAddress(address);
        console.log('Found patch:', patch);
        
        // Prevent default click behavior when multiselecting
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        if (e.ctrlKey || e.metaKey) {
            console.log('Multi-select mode (Ctrl/Cmd pressed)');
            // Multi-select with Ctrl/Cmd key
            if (patch) {
                console.log('Current selectedDevices before:', Array.from(this.selectedDevices));
                if (this.selectedDevices.has(patch.id)) {
                    console.log('Removing device from selection:', patch.id);
                    this.selectedDevices.delete(patch.id);
                } else {
                    console.log('Adding device to selection:', patch.id);
                    this.selectedDevices.add(patch.id);
                }
                console.log('Current selectedDevices after:', Array.from(this.selectedDevices));
                this.updateDeviceSelection();
            }
        } else if (e.shiftKey && patch) {
            console.log('Shift-click for range selection');
            // Shift-click for range selection - select all devices between last selection and current
            if (this.selectedDevices.size > 0) {
                const lastSelected = Array.from(this.selectedDevices)[this.selectedDevices.size - 1];
                const lastPatch = this.patchedDevices.find(p => p.id === lastSelected);
                if (lastPatch) {
                    const startAddr = Math.min(lastPatch.start_address, patch.start_address);
                    const endAddr = Math.max(lastPatch.start_address, patch.start_address);
                    
                    console.log('Range selection from', startAddr, 'to', endAddr);
                    this.patchedDevices.forEach(p => {
                        if (p.start_address >= startAddr && p.start_address <= endAddr) {
                            console.log('Adding to range selection:', p.device.name, 'at address', p.start_address);
                            this.selectedDevices.add(p.id);
                        }
                    });
                    this.updateDeviceSelection();
                }
            } else {
                // If no previous selection, just select this device
                console.log('No previous selection for range, selecting current device');
                this.selectedDevices.clear();
                this.selectedDevices.add(patch.id);
                this.updateDeviceSelection();
            }
        } else {
            console.log('Regular click (no modifier keys)');
            // Regular click - show info or clear selection
            if (patch) {
                console.log('Regular click on patch, clearing selection and adding device:', patch.id);
                this.selectedDevices.clear();
                this.selectedDevices.add(patch.id);
                console.log('Selected devices after regular click:', Array.from(this.selectedDevices));
                this.updateDeviceSelection();
                this.showAddressInfo(address);
            } else {
                console.log('Regular click on empty space, clearing selection');
                this.selectedDevices.clear();
                this.updateDeviceSelection();
            }
        }
    }
    
    handleMouseDown(e, address) {
        // Don't start dragging if multiselect keys are pressed
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            return;
        }
        
        if (e.button === 0) { // Left mouse button
            const patch = this.getPatchAtAddress(address);
            if (patch) {
                this.isDragging = true;
                this.dragStartAddress = address;
                
                // If clicked device is not selected, select only it
                if (!this.selectedDevices.has(patch.id)) {
                    this.selectedDevices.clear();
                    this.selectedDevices.add(patch.id);
                    this.updateDeviceSelection();
                }
                
                document.body.style.cursor = 'grabbing';
                e.preventDefault();
            }
        }
    }
    
    handleMouseUp(e, address) {
        if (this.isDragging && e.button === 0) {
            const targetAddress = parseInt(address);
            
            if (this.dragStartAddress !== targetAddress) {
                this.moveSelectedDevices(targetAddress);
            }
            
            this.stopDragging();
        }
    }
    
    handleMouseMove(e, address) {
        if (this.isDragging) {
            // Visual feedback during drag
            const element = e.target;
            if (this.canDropAtAddress(parseInt(address))) {
                element.style.backgroundColor = '#28a745'; // Green for valid drop
            } else {
                element.style.backgroundColor = '#dc3545'; // Red for invalid drop
            }
        }
    }
    
    handleContextMenu(e, address) {
        console.log('handleContextMenu called for address:', address);
        e.preventDefault();
        const patch = this.getPatchAtAddress(address);
        console.log('Context menu patch found:', patch);
        
        if (patch) {
            console.log('Patch found, current selection:', this.selectedDevices);
            // If right-clicked device is not selected, select only it
            if (!this.selectedDevices.has(patch.id)) {
                console.log('Device not selected, selecting it');
                this.selectedDevices.clear();
                this.selectedDevices.add(patch.id);
                this.updateDeviceSelection();
            }
            
            console.log('Showing context menu at:', e.clientX, e.clientY);
            this.showContextMenu(e.clientX, e.clientY);
        } else {
            console.log('No patch found at address:', address);
        }
    }
    
    handleGlobalMouseUp() {
        if (this.isDragging) {
            this.stopDragging();
        }
        this.hideContextMenu();
    }
    
    handleKeyDown(e) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.selectedDevices.size > 0) {
                this.removeSelectedDevices();
            }
        } else if (e.key === 'Escape') {
            this.selectedDevices.clear();
            this.updateDeviceSelection();
            this.hideContextMenu();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            this.selectAllDevices();
        }
    }
    
    // === HELPER METHODS ===
    
    refreshPatchedDevices() {
        console.log('Refreshing patched devices data...');
        
        // Fetch updated patched devices from API
        this.apiCall('/api/patched-devices')
            .then(response => {
                if (Array.isArray(response)) {
                    // Update local data
                    this.patchedDevices = response;
                    console.log('Updated patched devices:', this.patchedDevices.length);
                    
                    // Clear current selection since devices might have changed
                    this.selectedDevices.clear();
                    
                    // Refresh the display
                    this.updatePatchDisplay();
                    
                    console.log('Patch display refreshed successfully');
                } else {
                    console.error('Invalid response format for patched devices:', response);
                    this.showNotification('Error refreshing patch data', 'error');
                }
            })
            .catch(error => {
                console.error('Error refreshing patched devices:', error);
                this.showNotification('Error refreshing patch data', 'error');
            });
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
        console.log('updateDeviceSelection called with selectedDevices:', Array.from(this.selectedDevices));
        
        // Remove all selection styling first
        document.querySelectorAll('.dmx-address').forEach(addr => {
            addr.classList.remove('selected');
            // Clear inline selection styles
            addr.style.backgroundColor = '';
            addr.style.color = '';
            addr.style.borderColor = '';
            addr.style.boxShadow = '';
            addr.style.transform = '';
            addr.style.zIndex = '';
        });
        
        document.querySelectorAll('.device-name-label').forEach(label => {
            label.classList.remove('selected');
            // Clear inline selection styles
            label.style.backgroundColor = '';
            label.style.color = '';
            label.style.borderColor = '';
            label.style.boxShadow = '';
            label.style.transform = '';
            label.style.zIndex = '';
        });
        
        // If no devices selected, we're done
        if (this.selectedDevices.size === 0) {
            console.log('No devices selected, clearing all');
            return;
        }
        
        // Add selection styling to selected devices
        this.selectedDevices.forEach(patchId => {
            const patch = this.patchedDevices.find(p => p.id === patchId);
            console.log('Updating selection for patch ID:', patchId, 'found patch:', patch);
            if (patch) {
                const channels = this.parseDeviceChannels(patch.device);
                const channelCount = channels.length || 1;
                
                // Style all addresses for this device
                for (let i = 0; i < channelCount; i++) {
                    const addr = patch.start_address + i;
                    const element = document.querySelector(`[data-address="${addr}"]`);
                    if (element) {
                        console.log('Adding selected class to address:', addr);
                        element.classList.add('selected');
                    }
                }
                
                // Style the device label if it exists
                const label = document.querySelector(`[data-device-address="${patch.start_address}"]`);
                if (label) {
                    console.log('Adding selected class to label for device:', patch.device.name);
                    label.classList.add('selected');
                }
            }
        });
        
        console.log('Selection update complete, selected device count:', this.selectedDevices.size);
    }
    
    canDropAtAddress(targetAddress) {
        // Check if all selected devices can be moved to new positions
        let canDrop = true;
        
        this.selectedDevices.forEach(patchId => {
            const patch = this.patchedDevices.find(p => p.id === patchId);
            if (patch) {
                const channels = this.parseDeviceChannels(patch.device);
                const channelCount = channels.length || 1;
                const offset = targetAddress - patch.start_address;
                const newStart = patch.start_address + offset;
                
                if (newStart < 1 || newStart + channelCount - 1 > 512) {
                    canDrop = false;
                }
                
                // Check for conflicts with other devices
                for (let i = 0; i < channelCount; i++) {
                    const checkAddr = newStart + i;
                    const conflictPatch = this.patchedDevices.find(p => {
                        if (this.selectedDevices.has(p.id)) return false; // Skip selected devices
                        const conflictChannels = this.parseDeviceChannels(p.device);
                        const conflictCount = conflictChannels.length || 1;
                        return checkAddr >= p.start_address && checkAddr < p.start_address + conflictCount;
                    });
                    
                    if (conflictPatch) {
                        canDrop = false;
                    }
                }
            }
        });
        
        return canDrop;
    }
    
    moveSelectedDevices(targetAddress) {
        if (this.selectedDevices.size === 0) return;
        
        // Calculate the offset from the first selected device
        const firstPatch = this.patchedDevices.find(p => this.selectedDevices.has(p.id));
        if (!firstPatch) return;
        
        const offset = targetAddress - firstPatch.start_address;
        
        // Move all selected devices
        const movePromises = [];
        this.selectedDevices.forEach(patchId => {
            const patch = this.patchedDevices.find(p => p.id === patchId);
            if (patch) {
                const newAddress = patch.start_address + offset;
                movePromises.push(this.updatePatchAddress(patch.id, newAddress));
            }
        });
        
        Promise.all(movePromises).then(() => {
            // Refresh patched devices without page reload
            this.refreshPatchedDevices();
            this.showNotification('Devices moved successfully', 'success');
        }).catch(error => {
            console.error('Error moving devices:', error);
            this.showNotification('Error moving devices', 'error');
        });
    }
    
    showContextMenu(x, y) {
        console.log('showContextMenu called at position:', x, y);
        this.hideContextMenu(); // Remove any existing menu
        
        const menu = document.createElement('div');
        menu.id = 'contextMenu';
        menu.className = 'context-menu';
        menu.style.position = 'fixed';
        menu.style.top = `${y}px`;
        menu.style.left = `${x}px`;
        
        console.log('Context menu element created:', menu);
        
        const selectedCount = this.selectedDevices.size;
        console.log('Selected devices count for context menu:', selectedCount);
        const menuItems = [
            {
                text: `Remove ${selectedCount} device${selectedCount > 1 ? 's' : ''}`,
                action: () => {
                    console.log('Context menu remove action clicked');
                    this.removeSelectedDevices();
                }
            }
        ];
        
        menuItems.forEach((item, index) => {
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            if (index === menuItems.length - 1) {
                menuItem.classList.add('last-item');
            }
            menuItem.textContent = item.text;
            
            console.log('Adding menu item:', item.text);
            
            // Use mousedown to trigger the action since click is being intercepted
            let actionTriggered = false;
            
            menuItem.addEventListener('mousedown', (e) => {
                console.log('Menu item mousedown:', item.text);
                e.preventDefault();
                e.stopPropagation();
                
                if (!actionTriggered) {
                    actionTriggered = true;
                    console.log('Triggering action from mousedown');
                    // Delay slightly to ensure the event is processed
                    setTimeout(() => {
                        item.action();
                        this.hideContextMenu();
                    }, 10);
                }
            });
            
            menuItem.addEventListener('click', (e) => {
                console.log('Menu item clicked:', item.text);
                e.preventDefault();
                e.stopPropagation();
                
                if (!actionTriggered) {
                    actionTriggered = true;
                    console.log('Triggering action from click');
                    item.action();
                    this.hideContextMenu();
                }
            });
            
            menuItem.addEventListener('mouseup', (e) => {
                console.log('Menu item mouseup:', item.text);
                e.preventDefault();
                e.stopPropagation();
            });
            
            menu.appendChild(menuItem);
        });
        
        document.body.appendChild(menu);
        console.log('Context menu added to document body');
        
        // Hide menu when clicking elsewhere (but not immediately)
        setTimeout(() => {
            const hideHandler = (e) => {
                // Don't hide if clicking on the menu itself
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
    
    removeSelectedDevices() {
        console.log('removeSelectedDevices called, selected devices:', this.selectedDevices);
        if (this.selectedDevices.size === 0) return;
        
        const selectedCount = this.selectedDevices.size;
        console.log('Selected count:', selectedCount);
        
        if (confirm(`Are you sure you want to remove ${selectedCount} device${selectedCount > 1 ? 's' : ''}?`)) {
            console.log('User confirmed removal');
            const removePromises = [];
            
            this.selectedDevices.forEach(patchId => {
                console.log('Preparing to remove patch ID:', patchId);
                // Call the API directly since unpatchDevice has its own confirm dialog
                removePromises.push(
                    this.apiCall('/api/unpatch-device', 'POST', {
                        patch_id: patchId
                    })
                );
            });
            
            console.log('Remove promises:', removePromises);
            
            Promise.all(removePromises).then((responses) => {
                console.log('All removal API calls completed:', responses);
                this.selectedDevices.clear();
                // Refresh patched devices without page reload
                this.refreshPatchedDevices();
                this.showNotification('Devices removed successfully', 'success');
            }).catch(error => {
                console.error('Error removing devices:', error);
                this.showNotification('Error removing devices', 'error');
            });
        } else {
            console.log('User cancelled removal');
        }
    }
    
    selectAllDevices() {
        this.selectedDevices.clear();
        this.patchedDevices.forEach(patch => {
            this.selectedDevices.add(patch.id);
        });
        this.updateDeviceSelection();
    }
    
    stopDragging() {
        this.isDragging = false;
        this.dragStartAddress = null;
        document.body.style.cursor = '';
        
        // Reset all address background colors
        document.querySelectorAll('.dmx-address').forEach(addr => {
            addr.style.backgroundColor = '';
        });
    }
    
    async updatePatchAddress(patchId, newAddress) {
        const response = await fetch('/api/update-patch-address', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                patch_id: patchId,
                start_address: newAddress
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to update patch address: ${response.statusText}`);
        }
        
        return response.json();
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