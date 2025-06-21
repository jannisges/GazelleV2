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