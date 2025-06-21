// Device creation and management functionality

let channelCount = 0;
let deviceChannels = [];
let currentDeviceId = null;

// Channel type templates
const deviceTemplates = {
    'rgb_par': {
        name: 'RGB Par Can',
        channels: [
            { type: 'dimmer_channel', name: 'Dimmer' },
            { type: 'red_channel', name: 'Red' },
            { type: 'green_channel', name: 'Green' },
            { type: 'blue_channel', name: 'Blue' }
        ]
    },
    'rgbw_par': {
        name: 'RGBW Par Can',
        channels: [
            { type: 'dimmer_channel', name: 'Dimmer' },
            { type: 'red_channel', name: 'Red' },
            { type: 'green_channel', name: 'Green' },
            { type: 'blue_channel', name: 'Blue' },
            { type: 'white_channel', name: 'White' }
        ]
    },
    'moving_head': {
        name: 'Moving Head',
        channels: [
            { type: 'dimmer_channel', name: 'Dimmer' },
            { type: 'red_channel', name: 'Red' },
            { type: 'green_channel', name: 'Green' },
            { type: 'blue_channel', name: 'Blue' },
            { type: 'pan', name: 'Pan' },
            { type: 'tilt', name: 'Tilt' },
            { type: 'gobo1', name: 'Gobo' },
            { type: 'strobe', name: 'Strobe' }
        ]
    },
    'dimmer': {
        name: 'Simple Dimmer',
        channels: [
            { type: 'dimmer_channel', name: 'Dimmer' }
        ]
    },
    'strobe': {
        name: 'Strobe Light',
        channels: [
            { type: 'dimmer_channel', name: 'Brightness' },
            { type: 'strobe', name: 'Strobe Rate' }
        ]
    }
};

document.addEventListener('DOMContentLoaded', function() {
    // Check if editing existing device
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    
    if (editId) {
        loadDevice(editId);
    } else {
        // Start with one channel
        addChannel();
    }
    
    setupFormSubmission();
});

function addChannel() {
    channelCount++;
    const channelDiv = document.createElement('div');
    channelDiv.className = 'channel-item';
    channelDiv.dataset.channelId = channelCount;
    
    channelDiv.innerHTML = `
        <label>Channel ${channelCount}:</label>
        <select class="form-select" name="channel_${channelCount}_type" onchange="updatePreview()">
            <option value="dimmer_channel">Dimmer</option>
            <option value="dimmer_fine">Dimmer_fine</option>
            <option value="red_channel">Red</option>
            <option value="green_channel">Green</option>
            <option value="blue_channel">Blue</option>
            <option value="white_channel">White</option>
            <option value="pan">Pan</option>
            <option value="pan_fine">Pan_fine</option>
            <option value="tilt">Tilt</option>
            <option value="tilt_fine">Tilt_fine</option>
            <option value="gobo1">Gobo1</option>
            <option value="gobo2">Gobo2</option>
            <option value="gobo_rotation">Gobo_rotation</option>
            <option value="gobo_rotation_fine">Gobo_rotation_fine</option>
            <option value="color_wheel">Color_Wheel</option>
            <option value="strobe">Strobe</option>
            <option value="prism">Prism</option>
            <option value="prisma_rotation">Prisma_rotation</option>
            <option value="frost">Frost</option>
            <option value="zoom">Zoom</option>
            <option value="zoom_fine">Zoom_fine</option>
            <option value="focus">Focus</option>
            <option value="focus_fine">Focus_fine</option>
            <option value="macro">Macro</option>
            <option value="special_functions">Special_functions</option>
            <option value="reset">Reset</option>
            <option value="dummy">Dummy/Other</option>
        </select>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeChannel(${channelCount})">
            <i class="bi bi-trash"></i>
        </button>
    `;
    
    document.getElementById('channelList').appendChild(channelDiv);
    updatePreview();
}

function removeChannel(channelId) {
    const channelDiv = document.querySelector(`[data-channel-id="${channelId}"]`);
    if (channelDiv) {
        channelDiv.remove();
        updateChannelNumbers();
        updatePreview();
    }
}

function updateChannelNumbers() {
    const channels = document.querySelectorAll('.channel-item');
    channels.forEach((channel, index) => {
        const label = channel.querySelector('label');
        label.textContent = `Channel ${index + 1}:`;
        
        const select = channel.querySelector('select');
        select.name = `channel_${index + 1}_type`;
    });
    
    channelCount = channels.length;
}

function updatePreview() {
    const deviceName = document.getElementById('deviceName').value || 'Device';
    const deviceShape = document.getElementById('deviceShape').value || 'circle';
    const deviceColor = document.getElementById('deviceColor').value || '#ffffff';
    const channels = Array.from(document.querySelectorAll('.channel-item select')).map(select => ({
        type: select.value
    }));
    
    // Update device name
    document.getElementById('previewName').textContent = deviceName;
    
    // Update preview fixture shape and color
    const fixture = document.getElementById('previewFixture');
    fixture.className = `preview-fixture ${deviceShape}`;
    fixture.style.borderColor = deviceColor;
    fixture.style.boxShadow = `0 0 20px ${deviceColor}40`;
    
    // Update channel summary
    const summary = channels.map((ch, i) => 
        `<div class="d-flex justify-content-between">
            <span>Ch ${i + 1}:</span>
            <span class="badge" style="background-color: ${DMXUtils.getChannelTypeColor(ch.type)}">${ch.type.replace('_', ' ')}</span>
        </div>`
    ).join('');
    
    document.getElementById('channelSummary').innerHTML = summary || '<small class="text-muted">No channels configured</small>';
}

function selectShape(shape) {
    // Update hidden input
    document.getElementById('deviceShape').value = shape;
    
    // Update button states
    document.querySelectorAll('.shape-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-shape="${shape}"]`).classList.add('active');
    
    // Update preview
    updatePreview();
}

function loadTemplate(templateKey) {
    const template = deviceTemplates[templateKey];
    if (!template) return;
    
    // Set device name
    document.getElementById('deviceName').value = template.name;
    
    // Clear existing channels
    document.getElementById('channelList').innerHTML = '';
    channelCount = 0;
    
    // Add template channels
    template.channels.forEach(channel => {
        addChannel();
        const lastSelect = document.querySelector('.channel-item:last-child select');
        lastSelect.value = channel.type;
    });
    
    updatePreview();
}

function setupFormSubmission() {
    document.getElementById('deviceForm').addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = new FormData();
        const deviceName = document.getElementById('deviceName').value;
        
        if (!deviceName) {
            DMXUtils.showNotification('Please enter a device name', 'error');
            return;
        }
        
        const channels = [];
        document.querySelectorAll('.channel-item').forEach((item, index) => {
            const select = item.querySelector('select');
            channels.push({
                type: select.value,
                name: `Channel ${index + 1}`
            });
        });
        
        if (channels.length === 0) {
            DMXUtils.showNotification('Please add at least one channel', 'error');
            return;
        }
        
        const deviceData = {
            name: deviceName,
            channels: channels,
            shape: document.getElementById('deviceShape').value,
            color: document.getElementById('deviceColor').value
        };
        
        if (currentDeviceId) {
            deviceData.id = currentDeviceId;
        }
        
        DMXUtils.apiCall('/api/save-device', 'POST', deviceData)
        .then(response => {
            if (response.success) {
                DMXUtils.showNotification('Device saved successfully', 'success');
                setTimeout(() => {
                    window.location.href = '/patch';
                }, 1000);
            } else {
                DMXUtils.showNotification('Error saving device: ' + response.error, 'error');
            }
        })
        .catch(error => {
            console.error('Error saving device:', error);
            DMXUtils.showNotification('Error saving device', 'error');
        });
    });
}

function loadDevice(deviceId) {
    currentDeviceId = deviceId;
    
    DMXUtils.apiCall(`/api/get-device/${deviceId}`)
    .then(response => {
        if (response.success) {
            const device = response.device;
            
            // Set device name
            document.getElementById('deviceName').value = device.name;
            
            // Set device shape and color
            const deviceShape = device.shape || 'circle';
            document.getElementById('deviceShape').value = deviceShape;
            document.getElementById('deviceColor').value = device.color || '#ffffff';
            
            // Update shape button selection
            document.querySelectorAll('.shape-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            document.querySelector(`[data-shape="${deviceShape}"]`).classList.add('active');
            
            // Clear existing channels
            document.getElementById('channelList').innerHTML = '';
            channelCount = 0;
            
            // Load device channels
            const channels = JSON.parse(device.channels || '[]');
            channels.forEach(channel => {
                addChannel();
                const lastSelect = document.querySelector('.channel-item:last-child select');
                lastSelect.value = channel.type;
            });
            
            updatePreview();
        } else {
            DMXUtils.showNotification('Error loading device: ' + response.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error loading device:', error);
        DMXUtils.showNotification('Error loading device', 'error');
    });
}

function deleteDevice() {
    if (!currentDeviceId) return;
    
    if (confirm('Are you sure you want to delete this device? This will also remove all patch assignments.')) {
        DMXUtils.apiCall('/api/delete-device', 'POST', { device_id: currentDeviceId })
        .then(response => {
            if (response.success) {
                DMXUtils.showNotification('Device deleted successfully', 'success');
                setTimeout(() => {
                    window.location.href = '/patch';
                }, 1000);
            } else {
                DMXUtils.showNotification('Error deleting device: ' + response.error, 'error');
            }
        })
        .catch(error => {
            console.error('Error deleting device:', error);
            DMXUtils.showNotification('Error deleting device', 'error');
        });
    }
}