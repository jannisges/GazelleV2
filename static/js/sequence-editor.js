// Sequence editor module for DMX lighting control

class SequenceEditor {
    constructor(containerId, markersId) {
        this.container = document.getElementById(containerId);
        this.markersContainer = document.getElementById(markersId);
        this.events = [];
        this.duration = 0;
        this.zoomLevel = 1;
        this.scrollPosition = 0;
        this.selectedEvent = null;
        this.isExpanded = false;
        this.tracks = [];
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Right-click to add event
        this.container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const time = this.pixelToTime(e.offsetX);
            this.showAddEventDialog(time);
        });
        
        // Click to select events
        this.container.addEventListener('click', (e) => {
            if (e.target.classList.contains('sequence-event')) {
                this.selectEvent(e.target);
            } else {
                this.deselectEvent();
            }
        });
        
        // Double-click to edit events
        this.container.addEventListener('dblclick', (e) => {
            if (e.target.classList.contains('sequence-event')) {
                this.editEvent(e.target);
            }
        });
    }
    
    loadSequence(events, duration) {
        this.events = events || [];
        this.duration = duration || 0;
        this.render();
        this.updateMarkers();
    }
    
    setZoomLevel(zoomLevel) {
        this.zoomLevel = Math.max(1, Math.min(100, zoomLevel));
        this.render();
        this.updateMarkers();
    }
    
    setExpanded(expanded) {
        this.isExpanded = expanded;
        this.container.classList.toggle('sequence-expanded', expanded);
        this.render();
    }
    
    setDuration(duration) {
        this.duration = duration;
        this.updateMarkers();
    }
    
    setCurrentTime(time) {
        this.currentTime = time;
        // Update playhead position if it exists
        const playhead = document.getElementById('sequencePlayhead');
        if (playhead) {
            const pixelPosition = this.timeToPixel(time);
            playhead.style.left = pixelPosition + 'px';
        }
    }
    
    addEvent(eventData) {
        const event = {
            id: Date.now(),
            time: eventData.time,
            device_id: eventData.device_id,
            type: eventData.type,
            value: eventData.value,
            color: eventData.color || null,
            duration: eventData.duration || 0
        };
        
        this.events.push(event);
        this.events.sort((a, b) => a.time - b.time);
        this.render();
        
        // Dispatch change event
        this.dispatchChangeEvent();
    }
    
    removeEvent(eventId) {
        this.events = this.events.filter(event => event.id !== eventId);
        this.render();
        this.dispatchChangeEvent();
    }
    
    updateEvent(eventId, eventData) {
        const eventIndex = this.events.findIndex(event => event.id === eventId);
        if (eventIndex !== -1) {
            this.events[eventIndex] = { ...this.events[eventIndex], ...eventData };
            this.events.sort((a, b) => a.time - b.time);
            this.render();
            this.dispatchChangeEvent();
        }
    }
    
    render() {
        this.container.innerHTML = '';
        
        if (this.isExpanded) {
            this.renderExpandedTracks();
        } else {
            this.renderCollapsedTrack();
        }
        
        this.renderEvents();
    }
    
    renderExpandedTracks() {
        // Group events by device
        const deviceGroups = {};
        this.events.forEach(event => {
            if (!deviceGroups[event.device_id]) {
                deviceGroups[event.device_id] = [];
            }
            deviceGroups[event.device_id].push(event);
        });
        
        // Create tracks for each device
        Object.keys(deviceGroups).forEach((deviceId, index) => {
            const track = document.createElement('div');
            track.className = 'sequence-track';
            track.style.top = (index * 35) + 'px';
            track.dataset.deviceId = deviceId;
            
            // Add device label
            const label = document.createElement('div');
            label.className = 'track-label';
            label.textContent = `Device ${deviceId}`;
            label.style.position = 'absolute';
            label.style.left = '5px';
            label.style.top = '5px';
            label.style.fontSize = '12px';
            label.style.color = '#6c757d';
            track.appendChild(label);
            
            this.container.appendChild(track);
        });
        
        // Adjust container height
        this.container.style.height = (Object.keys(deviceGroups).length * 35) + 'px';
    }
    
    renderCollapsedTrack() {
        const track = document.createElement('div');
        track.className = 'sequence-track';
        track.style.top = '0px';
        this.container.appendChild(track);
        
        // Set container height
        this.container.style.height = '30px';
    }
    
    renderEvents() {
        this.events.forEach(event => {
            const eventElement = this.createEventElement(event);
            this.container.appendChild(eventElement);
        });
    }
    
    createEventElement(event) {
        const element = document.createElement('div');
        element.className = 'sequence-event';
        element.dataset.eventId = event.id;
        
        // Position
        const x = this.timeToPixel(event.time);
        const width = Math.max(20, this.timeToPixel(event.duration || 0.5));
        element.style.left = x + 'px';
        element.style.width = width + 'px';
        
        // Find track position
        let trackY = 2;
        if (this.isExpanded) {
            const deviceGroups = {};
            let deviceIndex = 0;
            this.events.forEach(e => {
                if (!deviceGroups[e.device_id]) {
                    deviceGroups[e.device_id] = deviceIndex++;
                }
            });
            trackY = (deviceGroups[event.device_id] || 0) * 35 + 2;
        }
        element.style.top = trackY + 'px';
        
        // Color based on event type
        let backgroundColor = '#007bff';
        switch (event.type) {
            case 'dimmer':
                backgroundColor = '#ffc107';
                break;
            case 'color':
                backgroundColor = event.color || '#28a745';
                break;
            case 'position':
                backgroundColor = '#6f42c1';
                break;
        }
        element.style.backgroundColor = backgroundColor;
        
        // Content
        element.innerHTML = `
            <span>${event.type}</span>
            <div class="event-actions" style="display: none;">
                <button class="btn btn-sm btn-outline-light" onclick="editEventFromElement(${event.id})">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-light" onclick="deleteEventFromElement(${event.id})">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;
        
        // Show actions on hover
        element.addEventListener('mouseenter', () => {
            element.querySelector('.event-actions').style.display = 'block';
        });
        
        element.addEventListener('mouseleave', () => {
            if (this.selectedEvent !== element) {
                element.querySelector('.event-actions').style.display = 'none';
            }
        });
        
        // Make draggable
        this.makeDraggable(element, event);
        
        return element;
    }
    
    makeDraggable(element, event) {
        let isDragging = false;
        let startX = 0;
        let startTime = event.time;
        
        element.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'I') return;
            
            isDragging = true;
            startX = e.clientX;
            startTime = event.time;
            element.style.opacity = '0.7';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            const deltaTime = this.pixelToTime(deltaX) - this.pixelToTime(0);
            const newTime = Math.max(0, startTime + deltaTime);
            
            element.style.left = this.timeToPixel(newTime) + 'px';
        });
        
        document.addEventListener('mouseup', (e) => {
            if (!isDragging) return;
            
            isDragging = false;
            element.style.opacity = '1';
            
            const deltaX = e.clientX - startX;
            const deltaTime = this.pixelToTime(deltaX) - this.pixelToTime(0);
            const newTime = Math.max(0, startTime + deltaTime);
            
            this.updateEvent(event.id, { time: newTime });
        });
    }
    
    selectEvent(element) {
        if (this.selectedEvent) {
            this.selectedEvent.classList.remove('selected');
            this.selectedEvent.querySelector('.event-actions').style.display = 'none';
        }
        
        this.selectedEvent = element;
        element.classList.add('selected');
        element.querySelector('.event-actions').style.display = 'block';
    }
    
    deselectEvent() {
        if (this.selectedEvent) {
            this.selectedEvent.classList.remove('selected');
            this.selectedEvent.querySelector('.event-actions').style.display = 'none';
            this.selectedEvent = null;
        }
    }
    
    showAddEventDialog(time) {
        // Set time in modal
        document.getElementById('eventTime').value = time.toFixed(2);
        
        // Load patched devices
        this.loadDevicesForEvent();
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('eventModal'));
        modal.show();
    }
    
    loadDevicesForEvent() {
        const deviceList = document.getElementById('deviceList');
        if (!deviceList) return;
        
        // This would normally load from the patched devices
        // For now, we'll use a placeholder
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
    
    editEvent(element) {
        const eventId = parseInt(element.dataset.eventId);
        const event = this.events.find(e => e.id === eventId);
        
        if (event) {
            // Populate modal with event data
            document.getElementById('eventTime').value = event.time;
            document.getElementById('eventType').value = event.type;
            
            // Update fields based on type
            updateEventFields();
            
            // Set values
            switch (event.type) {
                case 'dimmer':
                    if (document.getElementById('dimmerValue')) {
                        document.getElementById('dimmerValue').value = event.value;
                    }
                    break;
                case 'color':
                    if (document.getElementById('colorValue') && event.color) {
                        document.getElementById('colorValue').value = event.color;
                    }
                    break;
            }
            
            // Store event ID for update
            document.getElementById('eventModal').dataset.editingId = eventId;
            
            const modal = new bootstrap.Modal(document.getElementById('eventModal'));
            modal.show();
        }
    }
    
    updateMarkers() {
        if (!this.markersContainer) return;
        
        this.markersContainer.innerHTML = '';
        
        if (this.duration === 0) return;
        
        const width = this.markersContainer.clientWidth;
        const visibleDuration = this.duration / this.zoomLevel;
        
        // Calculate marker interval
        let interval = 1; // seconds
        if (visibleDuration > 600) interval = 60;
        else if (visibleDuration > 120) interval = 30;
        else if (visibleDuration > 60) interval = 10;
        else if (visibleDuration > 30) interval = 5;
        
        const startTime = this.scrollPosition * this.duration / this.zoomLevel;
        const endTime = startTime + visibleDuration;
        
        for (let time = Math.ceil(startTime / interval) * interval; time <= endTime; time += interval) {
            const x = this.timeToPixel(time);
            
            if (x >= 0 && x <= width) {
                const marker = document.createElement('div');
                marker.className = 'timeline-marker';
                marker.style.left = x + 'px';
                
                const isMajor = time % (interval * 5) === 0;
                if (isMajor) {
                    marker.classList.add('major');
                    
                    const label = document.createElement('div');
                    label.className = 'timeline-label';
                    label.textContent = this.formatTime(time);
                    label.style.left = x + 'px';
                    this.markersContainer.appendChild(label);
                }
                
                this.markersContainer.appendChild(marker);
            }
        }
    }
    
    timeToPixel(time) {
        if (this.duration === 0) return 0;
        const visibleDuration = this.duration / this.zoomLevel;
        const startTime = this.scrollPosition * (this.duration - visibleDuration);
        return ((time - startTime) / visibleDuration) * this.container.clientWidth;
    }
    
    pixelToTime(pixel) {
        const visibleDuration = this.duration / this.zoomLevel;
        const startTime = this.scrollPosition * (this.duration - visibleDuration);
        return startTime + (pixel / this.container.clientWidth) * visibleDuration;
    }
    
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
    
    dispatchChangeEvent() {
        const event = new CustomEvent('sequence-change', { 
            detail: { events: this.events } 
        });
        this.container.dispatchEvent(event);
    }
    
    getEvents() {
        return this.events;
    }
    
    clearEvents() {
        this.events = [];
        this.render();
        this.dispatchChangeEvent();
    }
}

// Initialize sequence editor
function initializeSequenceEditor() {
    if (document.getElementById('sequenceContainer')) {
        window.sequenceEditor = new SequenceEditor('sequenceContainer', 'sequenceMarkers');
        
        // Listen for sequence changes
        document.getElementById('sequenceContainer').addEventListener('sequence-change', (e) => {
            currentSequence.events = e.detail.events;
        });
    }
}

// Render sequence with events
function renderSequence() {
    if (window.sequenceEditor && currentSong) {
        window.sequenceEditor.loadSequence(currentSequence.events, currentSong.duration);
    }
}

// Global functions for event management
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