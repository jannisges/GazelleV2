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