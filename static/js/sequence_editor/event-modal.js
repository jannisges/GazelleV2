// Event modal management for sequence editor
class EventModal {
    constructor() {
        this.modal = null;
        this.isEditing = false;
        this.editingEventId = null;
        this.patchedDevices = [];
        
        this.initializeModal();
        this.setupEventListeners();
    }
    
    initializeModal() {
        this.modal = document.getElementById('eventModal');
        if (this.modal) {
            this.bootstrapModal = new bootstrap.Modal(this.modal);
        }
    }
    
    setupEventListeners() {
        const saveEventBtn = document.getElementById('saveEventBtn');
        if (saveEventBtn) {
            saveEventBtn.addEventListener('click', () => this.saveEvent());
        }

        // Listen for device selection changes
        const deviceList = document.getElementById('deviceList');
        if (deviceList) {
            deviceList.addEventListener('change', () => this.updateEventTypeOptions());
        }
    }
    
    showAddDialog(time) {
        if (!this.modal) return;

        this.isEditing = false;
        this.editingEventId = null;

        this.loadDevicesForEvent();
        this.resetForm();

        const timeField = document.getElementById('eventTime');
        if (timeField) {
            timeField.value = time.toFixed(2);
        }

        this.bootstrapModal.show();
    }
    
    editEvent(event) {
        if (!this.modal) return;

        this.isEditing = true;
        this.editingEventId = event.id;

        document.getElementById('eventTime').value = event.time;
        document.getElementById('eventEndTime').value = event.end_time || '';

        this.loadDevicesForEvent();

        // Need to wait for devices to load before selecting device and updating fields
        setTimeout(() => {
            // Select the device
            const deviceCheckbox = document.querySelector(`#deviceList input[value="${event.device_id}"]`);
            if (deviceCheckbox) {
                deviceCheckbox.checked = true;
            }

            // Update fields based on selected device
            this.updateEventTypeOptions();

            // Populate the specific event data
            this.populateEventData(event);
        }, 100);

        this.bootstrapModal.show();
    }
    
    populateEventData(event) {
        switch (event.type) {
            case 'dimmer':
                const dimmerValue = document.getElementById('dimmerValue');
                const dimmerDisplay = document.getElementById('dimmerValueDisplay');
                if (dimmerValue) {
                    dimmerValue.value = event.value;
                    if (dimmerDisplay) dimmerDisplay.textContent = event.value + '%';
                }
                break;
            case 'color':
                const colorValue = document.getElementById('colorValue');
                if (colorValue && event.color) {
                    colorValue.value = event.color;
                }
                break;
            case 'position':
                const panValue = document.getElementById('panValue');
                const tiltValue = document.getElementById('tiltValue');
                const panDisplay = document.getElementById('panValueDisplay');
                const tiltDisplay = document.getElementById('tiltValueDisplay');
                if (panValue && event.value && event.value.pan !== undefined) {
                    panValue.value = event.value.pan;
                    if (panDisplay) panDisplay.textContent = event.value.pan;
                }
                if (tiltValue && event.value && event.value.tilt !== undefined) {
                    tiltValue.value = event.value.tilt;
                    if (tiltDisplay) tiltDisplay.textContent = event.value.tilt;
                }
                break;
        }
    }
    
    getSupportedEventTypes(deviceChannels) {
        const supportedTypes = [];

        if (!deviceChannels || deviceChannels.length === 0) {
            return supportedTypes;
        }

        const channelTypes = deviceChannels.map(ch => ch.type);

        // Check if device supports dimmer
        if (channelTypes.includes('dimmer_channel')) {
            supportedTypes.push('dimmer');
        }

        // Check if device supports color (needs R, G, B channels)
        if (channelTypes.includes('red_channel') &&
            channelTypes.includes('green_channel') &&
            channelTypes.includes('blue_channel')) {
            supportedTypes.push('color');
        }

        // Check if device supports position (needs pan and tilt)
        if (channelTypes.includes('pan') && channelTypes.includes('tilt')) {
            supportedTypes.push('position');
        }

        return supportedTypes;
    }

    updateEventTypeOptions() {
        const selectedDeviceIds = this.getSelectedDevices();
        const fieldsContainer = document.getElementById('eventFields');

        if (!fieldsContainer) return;

        // Clear if no device selected
        if (selectedDeviceIds.length === 0) {
            fieldsContainer.innerHTML = '';
            return;
        }

        // Get the selected device
        const selectedDeviceId = selectedDeviceIds[0];
        const selectedPatch = this.patchedDevices.find(p => p.id === selectedDeviceId);

        if (!selectedPatch) {
            fieldsContainer.innerHTML = '';
            return;
        }

        // Get supported event types
        const supportedTypes = this.getSupportedEventTypes(selectedPatch.device.channels);

        if (supportedTypes.length === 0) {
            fieldsContainer.innerHTML = '<p class="text-muted">No supported event types for this device</p>';
            return;
        }

        // Build HTML for all supported event types
        let html = '';

        if (supportedTypes.includes('dimmer')) {
            html += `
                <div class="mb-4 pb-3 border-bottom">
                    <label class="form-label fw-bold">Dimmer Value (%)</label>
                    <input type="range" class="form-range" id="dimmerValue" min="0" max="100" value="100">
                    <div class="d-flex justify-content-between">
                        <small>0%</small>
                        <small id="dimmerValueDisplay">100%</small>
                    </div>
                </div>
            `;
        }

        if (supportedTypes.includes('color')) {
            html += `
                <div class="mb-4 pb-3 border-bottom">
                    <label class="form-label fw-bold">Color</label>
                    <input type="color" class="form-control form-control-color w-100" id="colorValue" value="#ffffff">
                </div>
            `;
        }

        if (supportedTypes.includes('position')) {
            html += `
                <div class="mb-3">
                    <label class="form-label fw-bold">Position</label>
                    <div class="row">
                        <div class="col-md-6">
                            <label class="form-label small">Pan</label>
                            <input type="range" class="form-range" id="panValue" min="0" max="255" value="128">
                            <small id="panValueDisplay">128</small>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label small">Tilt</label>
                            <input type="range" class="form-range" id="tiltValue" min="0" max="255" value="128">
                            <small id="tiltValueDisplay">128</small>
                        </div>
                    </div>
                </div>
            `;
        }

        fieldsContainer.innerHTML = html;

        // Add event listeners to update display values
        this.setupValueDisplayListeners();
    }

    setupValueDisplayListeners() {
        const dimmerValue = document.getElementById('dimmerValue');
        const colorValue = document.getElementById('colorValue');
        const panValue = document.getElementById('panValue');
        const tiltValue = document.getElementById('tiltValue');

        if (dimmerValue) {
            dimmerValue.addEventListener('input', (e) => {
                const display = document.getElementById('dimmerValueDisplay');
                if (display) display.textContent = e.target.value + '%';

                // Trigger live DMX output during playback
                this.triggerLiveDMXOutput();
            });
        }

        if (colorValue) {
            colorValue.addEventListener('input', (e) => {
                // Trigger live DMX output during playback
                this.triggerLiveDMXOutput();
            });
        }

        if (panValue) {
            panValue.addEventListener('input', (e) => {
                const display = document.getElementById('panValueDisplay');
                if (display) display.textContent = e.target.value;

                // Trigger live DMX output during playback
                this.triggerLiveDMXOutput();
            });
        }

        if (tiltValue) {
            tiltValue.addEventListener('input', (e) => {
                const display = document.getElementById('tiltValueDisplay');
                if (display) display.textContent = e.target.value;

                // Trigger live DMX output during playback
                this.triggerLiveDMXOutput();
            });
        }
    }

    triggerLiveDMXOutput() {
        console.log('[DMX] triggerLiveDMXOutput called');

        // Check if playback controller exists
        if (!window.playbackController) {
            console.log('[DMX] No playback controller found');
            return;
        }

        // Check if currently playing
        const isPlaying = window.playbackController.isCurrentlyPlaying();
        console.log('[DMX] Is playing:', isPlaying);

        if (!isPlaying) {
            console.log('[DMX] Not playing - skipping DMX output');
            return;
        }

        const eventDataArray = this.collectEventData();
        console.log('[DMX] Collected event data:', eventDataArray);

        if (!eventDataArray) {
            console.log('[DMX] No event data collected');
            return;
        }

        // Send DMX commands for each event type
        eventDataArray.forEach(eventData => {
            this.executeDMXEvent(eventData);
        });
    }

    executeDMXEvent(eventData) {
        const selectedDeviceId = eventData.device_id;
        const selectedPatch = this.patchedDevices.find(p => p.id === selectedDeviceId);

        if (!selectedPatch) {
            console.log('[DMX] No patched device found for ID:', selectedDeviceId);
            return;
        }

        console.log('[DMX] Executing event for device:', selectedPatch.device.name);
        console.log('[DMX] Event data:', eventData);
        console.log('[DMX] Device channels:', selectedPatch.device.channels);

        const channels = selectedPatch.device.channels;
        const startAddress = selectedPatch.start_address;
        const dmxChannels = {};

        // Build DMX channel updates based on event type
        switch (eventData.type) {
            case 'dimmer':
                channels.forEach((channel, index) => {
                    if (channel.type === 'dimmer_channel') {
                        const dmxAddress = startAddress + index;
                        const dmxValue = Math.round(eventData.value * 255 / 100);
                        dmxChannels[dmxAddress] = dmxValue;
                        console.log(`[DMX] Dimmer: CH${dmxAddress} = ${dmxValue}`);
                    }
                });
                break;

            case 'color':
                const hex = eventData.color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);

                console.log(`[DMX] Color RGB: ${r}, ${g}, ${b}`);

                channels.forEach((channel, index) => {
                    const dmxAddress = startAddress + index;
                    if (channel.type === 'red_channel') {
                        dmxChannels[dmxAddress] = r;
                        console.log(`[DMX] Red: CH${dmxAddress} = ${r}`);
                    } else if (channel.type === 'green_channel') {
                        dmxChannels[dmxAddress] = g;
                        console.log(`[DMX] Green: CH${dmxAddress} = ${g}`);
                    } else if (channel.type === 'blue_channel') {
                        dmxChannels[dmxAddress] = b;
                        console.log(`[DMX] Blue: CH${dmxAddress} = ${b}`);
                    }
                });
                break;

            case 'position':
                channels.forEach((channel, index) => {
                    const dmxAddress = startAddress + index;
                    if (channel.type === 'pan') {
                        dmxChannels[dmxAddress] = eventData.value.pan;
                        console.log(`[DMX] Pan: CH${dmxAddress} = ${eventData.value.pan}`);
                    } else if (channel.type === 'tilt') {
                        dmxChannels[dmxAddress] = eventData.value.tilt;
                        console.log(`[DMX] Tilt: CH${dmxAddress} = ${eventData.value.tilt}`);
                    }
                });
                break;
        }

        // Send to backend
        if (Object.keys(dmxChannels).length > 0) {
            console.log('[DMX] Sending channels to backend:', dmxChannels);
            fetch('/api/set-dmx-channels', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ channels: dmxChannels })
            })
            .then(response => response.json())
            .then(data => {
                console.log('[DMX] Backend response:', data);
            })
            .catch(error => {
                console.error('[DMX] Error setting DMX channels:', error);
            });
        } else {
            console.log('[DMX] No DMX channels to send');
        }
    }
    
    loadDevicesForEvent() {
        const deviceList = document.getElementById('deviceList');
        if (!deviceList) return;
        
        if (this.patchedDevices.length === 0) {
            // Load devices from API
            fetch('/api/patched-devices')
                .then(response => response.json())
                .then(data => {
                    this.patchedDevices = data;
                    this.renderDeviceList();
                })
                .catch(error => {
                    console.error('Error loading patched devices:', error);
                    this.renderFallbackDeviceList();
                });
        } else {
            this.renderDeviceList();
        }
    }
    
    renderDeviceList() {
        const deviceList = document.getElementById('deviceList');
        if (!deviceList) return;
        
        deviceList.innerHTML = '';
        this.patchedDevices.forEach(patch => {
            const checkbox = document.createElement('div');
            checkbox.className = 'form-check';
            checkbox.innerHTML = `
                <input class="form-check-input" type="checkbox" value="${patch.id}" id="device_${patch.id}">
                <label class="form-check-label" for="device_${patch.id}">
                    ${patch.device.name} (DMX: ${patch.start_address})
                </label>
            `;
            deviceList.appendChild(checkbox);
        });
    }
    
    renderFallbackDeviceList() {
        const deviceList = document.getElementById('deviceList');
        if (!deviceList) return;
        
        deviceList.innerHTML = `
            <div class="form-check">
                <input class="form-check-input" type="checkbox" value="1" id="device_1">
                <label class="form-check-label" for="device_1">RGB Par Can (Ch 1-4)</label>
            </div>
            <div class="form-check">
                <input class="form-check-input" type="checkbox" value="2" id="device_2">
                <label class="form-check-label" for="device_2">Moving Head (Ch 5-12)</label>
            </div>
        `;
    }
    
    saveEvent() {
        const eventDataArray = this.collectEventData();
        if (!eventDataArray) return;

        if (this.isEditing && window.sequenceEditor) {
            // When editing, update the existing event with the first matching type
            // This assumes we're editing one specific event type at a time
            window.sequenceEditor.updateEvent(this.editingEventId, eventDataArray[0]);
        } else if (window.sequenceEditor) {
            // When adding new, add all event types
            eventDataArray.forEach(eventData => {
                window.sequenceEditor.addEvent(eventData);
            });
        }

        this.bootstrapModal.hide();
    }
    
    collectEventData() {
        const time = parseFloat(document.getElementById('eventTime')?.value || 0);
        const endTime = parseFloat(document.getElementById('eventEndTime')?.value || 0);
        const selectedDeviceId = this.getSelectedDevices()[0];

        if (!selectedDeviceId) return null;

        // Collect all available event data based on which fields are present
        const events = [];

        // Check for dimmer
        const dimmerValue = document.getElementById('dimmerValue');
        if (dimmerValue) {
            events.push({
                time,
                end_time: endTime,
                type: 'dimmer',
                device_id: selectedDeviceId,
                value: parseInt(dimmerValue.value)
            });
        }

        // Check for color
        const colorValue = document.getElementById('colorValue');
        if (colorValue) {
            events.push({
                time,
                end_time: endTime,
                type: 'color',
                device_id: selectedDeviceId,
                color: colorValue.value
            });
        }

        // Check for position
        const panValue = document.getElementById('panValue');
        const tiltValue = document.getElementById('tiltValue');
        if (panValue && tiltValue) {
            events.push({
                time,
                end_time: endTime,
                type: 'position',
                device_id: selectedDeviceId,
                value: {
                    pan: parseInt(panValue.value),
                    tilt: parseInt(tiltValue.value)
                }
            });
        }

        // Return array of events or null if none
        return events.length > 0 ? events : null;
    }
    
    getSelectedDevices() {
        const deviceList = document.getElementById('deviceList');
        if (!deviceList) return [];
        
        const checkboxes = deviceList.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => parseInt(cb.value));
    }
    
    resetForm() {
        const form = this.modal?.querySelector('form');
        if (form) {
            form.reset();
        }

        // Clear event fields
        const fieldsContainer = document.getElementById('eventFields');
        if (fieldsContainer) {
            fieldsContainer.innerHTML = '';
        }
    }
    
    setPatchedDevices(devices) {
        this.patchedDevices = devices;
    }
}

// Global functions for backward compatibility
function editEventFromElement(eventId) {
    if (window.sequenceEditor) {
        const element = document.querySelector(`[data-event-id="${eventId}"]`);
        if (element) {
            window.sequenceEditor.editEvent(element);
        }
    }
}

function deleteEventFromElement(eventId) {
    if (confirm('Delete this event?')) {
        if (window.sequenceEditor) {
            window.sequenceEditor.removeEvent(eventId);
        }
    }
}

function updateEventFields() {
    if (window.eventModal) {
        window.eventModal.updateEventFields();
    }
}