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
        const eventTypeSelect = document.getElementById('eventType');
        if (eventTypeSelect) {
            eventTypeSelect.addEventListener('change', () => this.updateEventFields());
        }
        
        const saveEventBtn = document.getElementById('saveEventBtn');
        if (saveEventBtn) {
            saveEventBtn.addEventListener('click', () => this.saveEvent());
        }
    }
    
    showAddDialog(time) {
        if (!this.modal) return;
        
        this.isEditing = false;
        this.editingEventId = null;
        
        document.getElementById('eventTime').value = time.toFixed(2);
        this.loadDevicesForEvent();
        this.resetForm();
        
        this.bootstrapModal.show();
    }
    
    editEvent(event) {
        if (!this.modal) return;
        
        this.isEditing = true;
        this.editingEventId = event.id;
        
        document.getElementById('eventTime').value = event.time;
        document.getElementById('eventType').value = event.type;
        
        this.updateEventFields();
        this.populateEventData(event);
        this.loadDevicesForEvent();
        
        this.bootstrapModal.show();
    }
    
    populateEventData(event) {
        switch (event.type) {
            case 'dimmer':
                const dimmerValue = document.getElementById('dimmerValue');
                if (dimmerValue) {
                    dimmerValue.value = event.value;
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
                if (panValue && event.value && event.value.pan !== undefined) {
                    panValue.value = event.value.pan;
                }
                if (tiltValue && event.value && event.value.tilt !== undefined) {
                    tiltValue.value = event.value.tilt;
                }
                break;
        }
    }
    
    updateEventFields() {
        const eventType = document.getElementById('eventType')?.value;
        const fieldsContainer = document.getElementById('eventFields');
        
        if (!fieldsContainer) return;
        
        switch(eventType) {
            case 'dimmer':
                fieldsContainer.innerHTML = `
                    <div class="mb-3">
                        <label class="form-label">Dimmer Value (%)</label>
                        <input type="range" class="form-range" id="dimmerValue" min="0" max="100" value="100">
                        <div class="d-flex justify-content-between">
                            <small>0%</small>
                            <small>100%</small>
                        </div>
                    </div>
                `;
                break;
            case 'color':
                fieldsContainer.innerHTML = `
                    <div class="row">
                        <div class="col-md-6">
                            <label class="form-label">Color</label>
                            <input type="color" class="form-control form-control-color" id="colorValue" value="#ffffff">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">White</label>
                            <input type="range" class="form-range" id="whiteValue" min="0" max="255" value="0">
                        </div>
                    </div>
                `;
                break;
            case 'position':
                fieldsContainer.innerHTML = `
                    <div class="row">
                        <div class="col-md-6">
                            <label class="form-label">Pan</label>
                            <input type="range" class="form-range" id="panValue" min="0" max="255" value="128">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">Tilt</label>
                            <input type="range" class="form-range" id="tiltValue" min="0" max="255" value="128">
                        </div>
                    </div>
                `;
                break;
            default:
                fieldsContainer.innerHTML = '';
                break;
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
        const eventData = this.collectEventData();
        if (!eventData) return;
        
        if (this.isEditing && window.sequenceEditor) {
            window.sequenceEditor.updateEvent(this.editingEventId, eventData);
        } else if (window.sequenceEditor) {
            window.sequenceEditor.addEvent(eventData);
        }
        
        this.bootstrapModal.hide();
    }
    
    collectEventData() {
        const time = parseFloat(document.getElementById('eventTime')?.value || 0);
        const type = document.getElementById('eventType')?.value;
        
        if (!type) return null;
        
        const eventData = {
            time,
            type,
            device_id: this.getSelectedDevices()[0] || 1 // Use first selected device
        };
        
        switch (type) {
            case 'dimmer':
                const dimmerValue = document.getElementById('dimmerValue');
                eventData.value = dimmerValue ? parseInt(dimmerValue.value) : 100;
                break;
            case 'color':
                const colorValue = document.getElementById('colorValue');
                const whiteValue = document.getElementById('whiteValue');
                eventData.color = colorValue ? colorValue.value : '#ffffff';
                eventData.value = whiteValue ? parseInt(whiteValue.value) : 0;
                break;
            case 'position':
                const panValue = document.getElementById('panValue');
                const tiltValue = document.getElementById('tiltValue');
                eventData.value = {
                    pan: panValue ? parseInt(panValue.value) : 128,
                    tilt: tiltValue ? parseInt(tiltValue.value) : 128
                };
                break;
        }
        
        return eventData;
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
        
        document.getElementById('eventType').value = 'dimmer';
        this.updateEventFields();
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