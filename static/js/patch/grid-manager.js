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