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
        this.generateDMXGrid();
        this.updatePatchDisplay();
        this.initializePlanView();
        this.setupEventListeners();
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
            address.addEventListener('click', () => this.showAddressInfo(i));
            grid.appendChild(address);
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
        const dmxGrid = document.getElementById('dmxGrid');
        if (!dmxGrid) return;
        
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
            
            label.style.position = 'absolute';
            label.style.left = `${left}px`;
            label.style.top = `${top}px`;
            label.style.zIndex = '10';
            
            // Add to grid
            dmxGrid.appendChild(label);
            
            console.log(`Created device label: ${deviceName} above address ${firstAddressElement.dataset.address} at position ${left}, ${top}`);
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
            'dimmer': '#28a745',
            'red': '#dc3545',
            'green': '#28a745',
            'blue': '#007bff',
            'white': '#6c757d',
            'amber': '#ffc107',
            'uv': '#6f42c1',
            'pan': '#fd7e14',
            'tilt': '#20c997',
            'focus': '#e83e8c',
            'zoom': '#6610f2',
            'gobo': '#495057',
            'color': '#17a2b8',
            'speed': '#343a40',
            'strobe': '#f8f9fa',
            'macro': '#6c757d'
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
                // Reload patched devices
                location.reload();
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
                    location.reload();
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
                    location.reload();
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
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };
        
        if (data) {
            options.body = JSON.stringify(data);
        }
        
        return fetch(url, options)
            .then(response => response.json());
    }
    
    showNotification(message, type = 'info') {
        // Use DMXUtils if available, otherwise fallback to alert
        if (typeof DMXUtils !== 'undefined' && DMXUtils.showNotification) {
            DMXUtils.showNotification(message, type);
        } else {
            alert(message);
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