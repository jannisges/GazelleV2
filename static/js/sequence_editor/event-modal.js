// Event modal management for sequence editor
// Rewritten with checkbox-based settings and automatic time handling
class EventModal {
    constructor() {
        this.modal = null;
        this.isEditing = false;
        this.editingEventId = null;
        this.patchedDevices = [];
        this.clickTime = 0;
        this.preSelectedDeviceId = null;
        this.preSelectedSubTrackType = null;

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
            deviceList.addEventListener('change', (e) => {
                if (e.target.type === 'radio') {
                    this.updateEventTypeOptions();
                }
            });
        }
    }

    showAddDialog(time, deviceId = null, subTrackType = null) {
        if (!this.modal) return;

        this.isEditing = false;
        this.editingEventId = null;
        this.clickTime = time;
        this.preSelectedDeviceId = deviceId;
        this.preSelectedSubTrackType = subTrackType;

        // Update modal title
        const modalTitle = this.modal.querySelector('.modal-title');
        if (modalTitle) {
            modalTitle.textContent = 'Add Sequence Event';
        }

        this.loadDevicesForEvent();
        this.resetForm();

        // Set time display (read-only info)
        this.updateTimeDisplay(time);

        this.bootstrapModal.show();
    }

    editEvent(event) {
        if (!this.modal) return;

        this.isEditing = true;
        this.editingEventId = event.id;
        this.clickTime = event.time;

        // Update modal title
        const modalTitle = this.modal.querySelector('.modal-title');
        if (modalTitle) {
            modalTitle.textContent = 'Edit Sequence Event';
        }

        this.loadDevicesForEvent();

        // Wait for devices to load before populating
        setTimeout(() => {
            // Select the device (radio button)
            const deviceRadio = document.querySelector(`#deviceList input[value="${event.device_id}"]`);
            if (deviceRadio) {
                deviceRadio.checked = true;
            }

            // Update fields based on selected device
            this.updateEventTypeOptions();

            // Populate the specific event data
            setTimeout(() => {
                this.populateEventData(event);
            }, 50);
        }, 100);

        // Set time display
        this.updateTimeDisplay(event.time, event.duration);

        this.bootstrapModal.show();
    }

    updateTimeDisplay(time, duration = 2.0) {
        const timeInfo = document.getElementById('eventTimeInfo');
        if (timeInfo) {
            const startTime = this.formatTime(time);
            const endTime = this.formatTime(time + duration);
            timeInfo.innerHTML = `
                <div class="alert alert-info mb-3">
                    <i class="bi bi-clock"></i>
                    <strong>Event Time:</strong> ${startTime} - ${endTime}
                    <small>(${duration.toFixed(1)}s duration, adjustable in timeline)</small>
                </div>
            `;
        }
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(1);
        return `${minutes}:${secs.padStart(4, '0')}`;
    }

    populateEventData(event) {
        // Find and check the appropriate checkboxes based on event type
        const eventTypeCheckboxes = document.querySelectorAll('#eventTypeOptions input[type="checkbox"]');

        eventTypeCheckboxes.forEach(checkbox => {
            const settingType = checkbox.dataset.settingType;

            if (settingType === event.type) {
                checkbox.checked = true;

                // Populate values
                switch (event.type) {
                    case 'dimmer':
                        const dimmerValue = document.getElementById('dimmerValue');
                        const dimmerDisplay = document.getElementById('dimmerValueDisplay');
                        if (dimmerValue && event.value !== undefined) {
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
            } else {
                checkbox.checked = false;
            }
        });
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
        const selectedDeviceId = this.getSelectedDevice();
        const optionsContainer = document.getElementById('eventTypeOptions');

        if (!optionsContainer) return;

        // Clear if no device selected
        if (!selectedDeviceId) {
            optionsContainer.innerHTML = '<p class="text-muted">Please select a device first</p>';
            return;
        }

        // Get the selected device
        const selectedPatch = this.patchedDevices.find(p => p.id === selectedDeviceId);

        if (!selectedPatch) {
            optionsContainer.innerHTML = '<p class="text-muted">Device not found</p>';
            return;
        }

        // Get supported event types
        const supportedTypes = this.getSupportedEventTypes(selectedPatch.device.channels);

        if (supportedTypes.length === 0) {
            optionsContainer.innerHTML = '<p class="text-muted">No supported event types for this device</p>';
            return;
        }

        // Build HTML for all supported event types with checkboxes
        let html = '<div class="mb-3"><label class="form-label fw-bold">Select Settings to Configure:</label></div>';

        if (supportedTypes.includes('dimmer')) {
            const isPreSelected = this.preSelectedSubTrackType === 'dimmer';
            html += `
                <div class="form-check mb-3">
                    <input class="form-check-input" type="checkbox" id="enableDimmer" data-setting-type="dimmer" ${isPreSelected ? 'checked' : ''}>
                    <label class="form-check-label fw-bold" for="enableDimmer">
                        Dimmer
                    </label>
                </div>
                <div class="dimmer-settings ms-4 mb-4 pb-3 border-bottom">
                    <label class="form-label">Dimmer Value (%)</label>
                    <input type="range" class="form-range" id="dimmerValue" min="0" max="100" value="100">
                    <div class="d-flex justify-content-between">
                        <small>0%</small>
                        <small id="dimmerValueDisplay">100%</small>
                        <small>100%</small>
                    </div>
                </div>
            `;
        }

        if (supportedTypes.includes('color')) {
            const isPreSelected = this.preSelectedSubTrackType === 'color';
            html += `
                <div class="form-check mb-3">
                    <input class="form-check-input" type="checkbox" id="enableColor" data-setting-type="color" ${isPreSelected ? 'checked' : ''}>
                    <label class="form-check-label fw-bold" for="enableColor">
                        Color
                    </label>
                </div>
                <div class="color-settings ms-4 mb-4 pb-3 border-bottom">
                    <label class="form-label">Color</label>
                    <input type="color" class="form-control form-control-color w-100" id="colorValue" value="#ffffff">
                </div>
            `;
        }

        if (supportedTypes.includes('position')) {
            const isPreSelected = this.preSelectedSubTrackType === 'position';
            html += `
                <div class="form-check mb-3">
                    <input class="form-check-input" type="checkbox" id="enablePosition" data-setting-type="position" ${isPreSelected ? 'checked' : ''}>
                    <label class="form-check-label fw-bold" for="enablePosition">
                        Position
                    </label>
                </div>
                <div class="position-settings ms-4 mb-3">
                    <label class="form-label">Position</label>
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

        optionsContainer.innerHTML = html;

        // Add event listeners to update display values and handle checkboxes
        this.setupValueDisplayListeners();
        this.setupCheckboxListeners();

        // Clear pre-selection after first use
        this.preSelectedSubTrackType = null;
    }

    setupCheckboxListeners() {
        const checkboxes = document.querySelectorAll('#eventTypeOptions input[type="checkbox"]');

        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const settingType = e.target.dataset.settingType;
                const settingsDiv = document.querySelector(`.${settingType}-settings`);

                if (settingsDiv) {
                    if (e.target.checked) {
                        settingsDiv.style.opacity = '1';
                        settingsDiv.style.pointerEvents = 'auto';
                    } else {
                        settingsDiv.style.opacity = '0.3';
                        settingsDiv.style.pointerEvents = 'none';
                    }
                }
            });

            // Initialize state
            const event = new Event('change');
            checkbox.dispatchEvent(event);
        });
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
            colorValue.addEventListener('input', () => {
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

        if (!eventDataArray || eventDataArray.length === 0) {
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
            const radio = document.createElement('div');
            radio.className = 'form-check';

            const isPreSelected = this.preSelectedDeviceId === patch.id;

            radio.innerHTML = `
                <input class="form-check-input" type="radio" name="deviceSelection" value="${patch.id}" id="device_${patch.id}" ${isPreSelected ? 'checked' : ''}>
                <label class="form-check-label" for="device_${patch.id}">
                    ${patch.device.name} <small class="text-muted">(DMX: ${patch.start_address})</small>
                </label>
            `;
            deviceList.appendChild(radio);
        });

        // If a device is pre-selected, trigger the update
        if (this.preSelectedDeviceId) {
            this.updateEventTypeOptions();
        }
    }

    renderFallbackDeviceList() {
        const deviceList = document.getElementById('deviceList');
        if (!deviceList) return;

        deviceList.innerHTML = `
            <div class="form-check">
                <input class="form-check-input" type="radio" name="deviceSelection" value="1" id="device_1">
                <label class="form-check-label" for="device_1">RGB Par Can (Ch 1-4)</label>
            </div>
            <div class="form-check">
                <input class="form-check-input" type="radio" name="deviceSelection" value="2" id="device_2">
                <label class="form-check-label" for="device_2">Moving Head (Ch 5-12)</label>
            </div>
        `;
    }

    saveEvent() {
        const eventDataArray = this.collectEventData();
        if (!eventDataArray || eventDataArray.length === 0) {
            alert('Please select at least one setting to configure');
            return;
        }

        if (this.isEditing && window.sequenceEditor) {
            // When editing, update the existing event
            // Only update if the type matches the original event
            const originalEvent = window.sequenceEditor.getEvents().find(e => e.id === this.editingEventId);
            const matchingEvent = eventDataArray.find(e => e.type === originalEvent.type);

            if (matchingEvent) {
                window.sequenceEditor.updateEvent(this.editingEventId, matchingEvent);
            } else {
                // If type changed, remove old and add new
                window.sequenceEditor.removeEvent(this.editingEventId);
                eventDataArray.forEach(eventData => {
                    window.sequenceEditor.addEvent(eventData);
                });
            }
        } else if (window.sequenceEditor) {
            // When adding new, add all selected event types
            eventDataArray.forEach(eventData => {
                window.sequenceEditor.addEvent(eventData);
            });
        }

        this.bootstrapModal.hide();
    }

    collectEventData() {
        const time = this.clickTime;
        const selectedDeviceId = this.getSelectedDevice();

        if (!selectedDeviceId) {
            alert('Please select a device');
            return null;
        }

        // Collect only checked event types
        const events = [];
        const checkboxes = document.querySelectorAll('#eventTypeOptions input[type="checkbox"]:checked');

        checkboxes.forEach(checkbox => {
            const settingType = checkbox.dataset.settingType;

            switch (settingType) {
                case 'dimmer':
                    const dimmerValue = document.getElementById('dimmerValue');
                    if (dimmerValue) {
                        events.push({
                            time,
                            duration: 2.0, // Default 2 seconds
                            type: 'dimmer',
                            device_id: selectedDeviceId,
                            value: parseInt(dimmerValue.value)
                        });
                    }
                    break;

                case 'color':
                    const colorValue = document.getElementById('colorValue');
                    if (colorValue) {
                        events.push({
                            time,
                            duration: 2.0, // Default 2 seconds
                            type: 'color',
                            device_id: selectedDeviceId,
                            color: colorValue.value
                        });
                    }
                    break;

                case 'position':
                    const panValue = document.getElementById('panValue');
                    const tiltValue = document.getElementById('tiltValue');
                    if (panValue && tiltValue) {
                        events.push({
                            time,
                            duration: 2.0, // Default 2 seconds
                            type: 'position',
                            device_id: selectedDeviceId,
                            value: {
                                pan: parseInt(panValue.value),
                                tilt: parseInt(tiltValue.value)
                            }
                        });
                    }
                    break;
            }
        });

        return events.length > 0 ? events : null;
    }

    getSelectedDevice() {
        const deviceList = document.getElementById('deviceList');
        if (!deviceList) return null;

        const checkedRadio = deviceList.querySelector('input[type="radio"]:checked');
        return checkedRadio ? parseInt(checkedRadio.value) : null;
    }

    resetForm() {
        // Clear device selection
        const deviceRadios = document.querySelectorAll('#deviceList input[type="radio"]');
        deviceRadios.forEach(radio => radio.checked = false);

        // Clear event type options
        const optionsContainer = document.getElementById('eventTypeOptions');
        if (optionsContainer) {
            optionsContainer.innerHTML = '<p class="text-muted">Please select a device first</p>';
        }

        // Clear time info
        const timeInfo = document.getElementById('eventTimeInfo');
        if (timeInfo) {
            timeInfo.innerHTML = '';
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
