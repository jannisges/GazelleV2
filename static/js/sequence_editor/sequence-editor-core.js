// Core SequenceEditor class for timeline visualization and event management
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
        this.currentTime = 0;
        this.needsFullRender = true;
        this.isPlaying = false;
        
        // Performance optimizations
        this.eventElements = new Map(); // Cache DOM elements by event ID
        this.trackElements = new Map(); // Cache track elements
        this.lastRenderParams = null;
        this.animationFrameId = null;
        
        // Virtual scrolling parameters
        this.visibleEvents = new Set();
        this.eventPool = [];
        
        this.setupPlayheadOverlay();
        this.setupEventListeners();
    }
    
    setupPlayheadOverlay() {
        this.playheadOverlay = document.createElement('div');
        this.playheadOverlay.style.position = 'absolute';
        this.playheadOverlay.style.top = '0';
        this.playheadOverlay.style.left = '0';
        this.playheadOverlay.style.width = '100%';
        this.playheadOverlay.style.height = '100%';
        this.playheadOverlay.style.pointerEvents = 'none';
        this.playheadOverlay.style.zIndex = '10';
        
        this.playheadLine = document.createElement('div');
        this.playheadLine.style.position = 'absolute';
        this.playheadLine.style.width = '2px';
        this.playheadLine.style.height = '100%';
        this.playheadLine.style.backgroundColor = '#dc3545';
        this.playheadLine.style.display = 'none';
        this.playheadLine.style.top = '0';
        
        this.playheadOverlay.appendChild(this.playheadLine);
        this.container.appendChild(this.playheadOverlay);
    }
    
    setupEventListeners() {
        this.container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const time = this.pixelToTime(e.offsetX);
            this.showAddEventDialog(time);
        });
        
        this.container.addEventListener('click', (e) => {
            if (e.target.classList.contains('sequence-event')) {
                this.selectEvent(e.target);
            } else {
                this.deselectEvent();
            }
        });
        
        this.container.addEventListener('dblclick', (e) => {
            if (e.target.classList.contains('sequence-event')) {
                this.editEvent(e.target);
            }
        });
        
        this.setupZoomAndScroll();
    }
    
    setupZoomAndScroll() {
        // Throttle wheel zoom events
        let wheelTimeout = null;
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Clear previous timeout
            if (wheelTimeout) {
                clearTimeout(wheelTimeout);
            }
            
            // Throttle to 16ms (60 FPS)
            wheelTimeout = setTimeout(() => {
                const rect = this.container.getBoundingClientRect();
                const mouseX = (e.clientX - rect.left) / rect.width;
                
                const zoomFactor = e.deltaY > 0 ? 0.8 : 1.25;
                const newZoomLevel = Math.max(1, Math.min(100, this.zoomLevel * zoomFactor));
                
                if (newZoomLevel !== this.zoomLevel) {
                    // Calculate the time at mouse position before zoom
                    const mouseTime = this.pixelToTime((e.clientX - rect.left));
                    
                    // Update zoom level first
                    this.zoomLevel = newZoomLevel;
                    
                    // Calculate new scroll position to keep mouse time at same pixel
                    const visibleDuration = this.duration / this.zoomLevel;
                    const targetTime = mouseTime - (mouseX * visibleDuration);
                    const maxScroll = Math.max(0, this.duration - visibleDuration);
                    const newScrollPosition = maxScroll > 0 ? Math.max(0, Math.min(1, targetTime / maxScroll)) : 0;
                    
                    this.scrollPosition = newScrollPosition;
                    this.scheduleRender();
                    
                    // Dispatch zoom change event for synchronization
                    const event = new CustomEvent('sequence-zoom-change', { 
                        detail: { zoomLevel: this.zoomLevel, scrollPosition: this.scrollPosition } 
                    });
                    this.container.dispatchEvent(event);
                }
            }, 16);
        });
        
        this.setupDragScroll();
    }
    
    setupDragScroll() {
        let isDragging = false;
        let lastX = 0;
        
        this.container.addEventListener('mousedown', (e) => {
            if (this.zoomLevel > 1 && !e.target.classList.contains('sequence-event')) {
                isDragging = true;
                lastX = e.clientX;
                this.container.style.cursor = 'grabbing';
            }
        });
        
        // Throttle drag scroll events
        let dragTimeout = null;
        this.container.addEventListener('mousemove', (e) => {
            if (isDragging) {
                // Clear previous timeout
                if (dragTimeout) {
                    clearTimeout(dragTimeout);
                }
                
                // Throttle to 16ms (60 FPS)
                dragTimeout = setTimeout(() => {
                    const deltaX = e.clientX - lastX;
                    const scrollDelta = -(deltaX / this.container.clientWidth) * (1 / this.zoomLevel);
                    const maxScrollPosition = this.zoomLevel > 1 ? 1 : 0;
                    const newScrollPosition = Math.max(0, Math.min(maxScrollPosition, 
                        this.scrollPosition + scrollDelta));
                    
                    if (newScrollPosition !== this.scrollPosition) {
                        this.scrollPosition = newScrollPosition;
                        lastX = e.clientX;
                        this.scheduleRender();
                        this.updateMarkers();
                        this.updatePlayhead();
                        this.dispatchScrollEvent();
                    }
                }, 16);
            }
        });
        
        this.container.addEventListener('mouseup', () => {
            isDragging = false;
            this.container.style.cursor = 'default';
        });
        
        this.container.addEventListener('mouseleave', () => {
            isDragging = false;
            this.container.style.cursor = 'default';
        });
    }
    
    scheduleRender() {
        // Use requestAnimationFrame to batch render operations
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        
        this.animationFrameId = requestAnimationFrame(() => {
            this.render();
            this.animationFrameId = null;
        });
    }
    
    shouldFullRender() {
        // Check if a full re-render is needed based on current parameters
        const currentParams = {
            zoomLevel: this.zoomLevel,
            scrollPosition: this.scrollPosition,
            duration: this.duration,
            eventsCount: this.events.length,
            isExpanded: this.isExpanded,
            containerWidth: this.container.clientWidth,
            containerHeight: this.container.clientHeight
        };
        
        if (!this.lastRenderParams) {
            this.lastRenderParams = currentParams;
            return true;
        }
        
        const needsFullRender = Object.keys(currentParams).some(key => 
            this.lastRenderParams[key] !== currentParams[key]
        );
        
        if (needsFullRender) {
            this.lastRenderParams = currentParams;
        }
        
        return needsFullRender || this.needsFullRender;
    }
    
    loadSequence(events, duration) {
        this.events = events || [];
        this.duration = duration || 0;
        this.needsFullRender = true;
        this.scheduleRender();
        this.updateMarkers();
    }
    
    setZoomLevel(zoomLevel) {
        const newZoom = Math.max(1, Math.min(100, zoomLevel));
        if (newZoom !== this.zoomLevel) {
            this.zoomLevel = newZoom;
            this.needsFullRender = true;
            this.scheduleRender();
            this.updateMarkers();
            this.updatePlayhead();
            this.dispatchZoomEvent();
        }
    }
    
    setScrollPosition(scrollPosition) {
        const maxScrollPosition = this.zoomLevel > 1 ? 1 : 0;
        const newScroll = Math.max(0, Math.min(maxScrollPosition, scrollPosition));
        if (newScroll !== this.scrollPosition) {
            this.scrollPosition = newScroll;
            this.scheduleRender();
            this.updateMarkers();
            this.updatePlayhead();
            this.dispatchScrollEvent();
        }
    }
    
    syncFromExternal(zoomLevel, scrollPosition) {
        const zoomChanged = this.zoomLevel !== zoomLevel;
        const scrollChanged = this.scrollPosition !== scrollPosition;
        
        this.zoomLevel = Math.max(1, Math.min(100, zoomLevel));
        const maxScrollPosition = this.zoomLevel > 1 ? 1 : 0;
        this.scrollPosition = Math.max(0, Math.min(maxScrollPosition, scrollPosition));
        
        // During playback, only render if zoom actually changed (scroll changes are frequent)
        if (zoomChanged || !this.isPlaying) {
            this.needsFullRender = true;
            this.scheduleRender();
            this.updateMarkers();
        }
        this.updatePlayhead();
    }
    
    setExpanded(expanded) {
        this.isExpanded = expanded;
        this.container.classList.toggle('sequence-expanded', expanded);
        this.needsFullRender = true;
        this.scheduleRender();
    }
    
    setDuration(duration) {
        this.duration = duration;
        this.updateMarkers();
    }
    
    setCurrentTime(time) {
        this.currentTime = time;
        this.updatePlayhead();
    }
    
    setPlaying(isPlaying) {
        this.isPlaying = isPlaying;
    }
    
    updatePlayhead() {
        if (!this.playheadLine) return;
        
        if (this.currentTime > 0) {
            const x = this.timeToPixel(this.currentTime);
            const containerWidth = this.container.clientWidth;
            
            if (x >= 0 && x <= containerWidth) {
                this.playheadLine.style.display = 'block';
                this.playheadLine.style.left = x + 'px';
            } else {
                this.playheadLine.style.display = 'none';
            }
        } else {
            this.playheadLine.style.display = 'none';
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
        this.needsFullRender = true;
        this.scheduleRender();
        this.dispatchChangeEvent();
    }
    
    removeEvent(eventId) {
        this.events = this.events.filter(event => event.id !== eventId);
        this.needsFullRender = true;
        this.scheduleRender();
        this.dispatchChangeEvent();
    }
    
    updateEvent(eventId, eventData) {
        const eventIndex = this.events.findIndex(event => event.id === eventId);
        if (eventIndex !== -1) {
            this.events[eventIndex] = { ...this.events[eventIndex], ...eventData };
            this.events.sort((a, b) => a.time - b.time);
            this.needsFullRender = true;
            this.scheduleRender();
            this.dispatchChangeEvent();
        }
    }
    
    render() {
        if (this.shouldFullRender()) {
            this.renderContentOptimized();
            this.needsFullRender = false;
        } else {
            // Only update event positions for scroll/zoom changes
            this.updateEventPositions();
        }
    }
    
    renderContentOptimized() {
        // Use DocumentFragment for batch DOM operations
        const fragment = document.createDocumentFragment();
        
        // Preserve playhead overlay
        const playheadOverlay = this.playheadOverlay;
        if (playheadOverlay && playheadOverlay.parentNode === this.container) {
            this.container.removeChild(playheadOverlay);
        }
        
        // Clear container efficiently
        while (this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        
        // Clear caches
        this.eventElements.clear();
        this.trackElements.clear();
        
        // Render tracks
        if (this.isExpanded) {
            this.renderExpandedTracksOptimized(fragment);
        } else {
            this.renderCollapsedTrackOptimized(fragment);
        }
        
        // Render visible events with virtual scrolling
        this.renderEventsOptimized(fragment);
        
        // Batch append to DOM
        this.container.appendChild(fragment);
        
        // Restore playhead overlay
        if (playheadOverlay) {
            this.container.appendChild(playheadOverlay);
        }
    }
    
    updateEventPositions() {
        // Update only the positions of existing event elements
        this.eventElements.forEach((element, eventId) => {
            const event = this.events.find(e => e.id === eventId);
            if (event) {
                const x = this.timeToPixel(event.time);
                const width = Math.max(20, this.timeToPixel(event.duration || 0.5));
                element.style.left = x + 'px';
                element.style.width = width + 'px';
                
                // Update track position if expanded
                if (this.isExpanded) {
                    const trackY = this.getTrackY(event);
                    element.style.top = trackY + 'px';
                }
            }
        });
    }
    
    getTrackY(event) {
        if (!this.isExpanded) return 2;
        
        const deviceGroups = {};
        let deviceIndex = 0;
        this.events.forEach(e => {
            if (!deviceGroups[e.device_id]) {
                deviceGroups[e.device_id] = deviceIndex++;
            }
        });
        return (deviceGroups[event.device_id] || 0) * 35 + 2;
    }
    
    renderExpandedTracksOptimized(fragment) {
        const deviceGroups = {};
        this.events.forEach(event => {
            if (!deviceGroups[event.device_id]) {
                deviceGroups[event.device_id] = [];
            }
            deviceGroups[event.device_id].push(event);
        });
        
        Object.keys(deviceGroups).forEach((deviceId, index) => {
            const track = this.createTrackElement(deviceId, index);
            this.trackElements.set(deviceId, track);
            fragment.appendChild(track);
        });
        
        this.container.style.height = (Object.keys(deviceGroups).length * 35) + 'px';
    }
    
    renderCollapsedTrackOptimized(fragment) {
        const track = this.createTrackElement('main', 0);
        this.trackElements.set('main', track);
        fragment.appendChild(track);
        
        if (!this.container.style.height || this.container.style.height === '30px') {
            this.container.style.height = '';
        }
    }
    
    createTrackElement(deviceId, index) {
        const track = document.createElement('div');
        track.className = 'sequence-track';
        track.style.top = (index * 35) + 'px';
        track.dataset.deviceId = deviceId;
        
        if (deviceId !== 'main') {
            const label = document.createElement('div');
            label.className = 'track-label';
            label.textContent = `Device ${deviceId}`;
            label.style.position = 'absolute';
            label.style.left = '5px';
            label.style.top = '5px';
            label.style.fontSize = '12px';
            label.style.color = '#6c757d';
            track.appendChild(label);
        }
        
        return track;
    }
    
    renderEventsOptimized(fragment) {
        // Implement virtual scrolling for large event lists
        const visibleRange = this.getVisibleTimeRange();
        const visibleEvents = this.events.filter(event => 
            this.isEventVisible(event, visibleRange)
        );
        
        // Limit rendering to visible events for performance
        const maxVisibleEvents = 1000;
        const eventsToRender = visibleEvents.slice(0, maxVisibleEvents);
        
        eventsToRender.forEach(event => {
            const eventElement = this.createEventElementOptimized(event);
            this.eventElements.set(event.id, eventElement);
            fragment.appendChild(eventElement);
        });
    }
    
    getVisibleTimeRange() {
        const visibleDuration = this.duration / this.zoomLevel;
        const startTime = this.scrollPosition * (this.duration - visibleDuration);
        const endTime = startTime + visibleDuration;
        const buffer = visibleDuration * 0.1; // 10% buffer for smooth scrolling
        
        return {
            start: Math.max(0, startTime - buffer),
            end: Math.min(this.duration, endTime + buffer)
        };
    }
    
    isEventVisible(event, visibleRange) {
        const eventEnd = event.time + (event.duration || 0.5);
        return event.time <= visibleRange.end && eventEnd >= visibleRange.start;
    }
    
    createEventElementOptimized(event) {
        // Reuse elements from pool if available
        let element = this.eventPool.pop();
        if (!element) {
            element = document.createElement('div');
            element.className = 'sequence-event';
        }
        
        // Update element properties
        element.dataset.eventId = event.id;
        
        const x = this.timeToPixel(event.time);
        const width = Math.max(20, this.timeToPixel(event.duration || 0.5));
        element.style.left = x + 'px';
        element.style.width = width + 'px';
        element.style.top = this.getTrackY(event) + 'px';
        element.style.backgroundColor = this.getEventColor(event);
        
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
        
        this.setupEventHover(element);
        this.makeDraggable(element, event);
        
        return element;
    }
    
    renderContent() {
        const playheadOverlay = this.playheadOverlay;
        if (playheadOverlay && playheadOverlay.parentNode === this.container) {
            this.container.removeChild(playheadOverlay);
        }
        
        this.container.innerHTML = '';
        
        if (this.isExpanded) {
            this.renderExpandedTracks();
        } else {
            this.renderCollapsedTrack();
        }
        
        this.renderEvents();
        
        if (playheadOverlay) {
            this.container.appendChild(playheadOverlay);
        }
    }
    
    renderExpandedTracks() {
        const deviceGroups = {};
        this.events.forEach(event => {
            if (!deviceGroups[event.device_id]) {
                deviceGroups[event.device_id] = [];
            }
            deviceGroups[event.device_id].push(event);
        });
        
        Object.keys(deviceGroups).forEach((deviceId, index) => {
            const track = document.createElement('div');
            track.className = 'sequence-track';
            track.style.top = (index * 35) + 'px';
            track.dataset.deviceId = deviceId;
            
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
        
        this.container.style.height = (Object.keys(deviceGroups).length * 35) + 'px';
    }
    
    renderCollapsedTrack() {
        const track = document.createElement('div');
        track.className = 'sequence-track';
        track.style.top = '0px';
        this.container.appendChild(track);
        
        if (!this.container.style.height || this.container.style.height === '30px') {
            this.container.style.height = '';
        }
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
        
        const x = this.timeToPixel(event.time);
        const width = Math.max(20, this.timeToPixel(event.duration || 0.5));
        element.style.left = x + 'px';
        element.style.width = width + 'px';
        
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
        
        element.style.backgroundColor = this.getEventColor(event);
        
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
        
        this.setupEventHover(element);
        this.makeDraggable(element, event);
        
        return element;
    }
    
    getEventColor(event) {
        switch (event.type) {
            case 'dimmer': return '#ffc107';
            case 'color': return event.color || '#28a745';
            case 'position': return '#6f42c1';
            default: return '#007bff';
        }
    }
    
    setupEventHover(element) {
        element.addEventListener('mouseenter', () => {
            element.querySelector('.event-actions').style.display = 'block';
        });
        
        element.addEventListener('mouseleave', () => {
            if (this.selectedEvent !== element) {
                element.querySelector('.event-actions').style.display = 'none';
            }
        });
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
    
    editEvent(element) {
        const eventId = parseInt(element.dataset.eventId);
        const event = this.events.find(e => e.id === eventId);
        
        if (event && window.eventModal) {
            window.eventModal.editEvent(event);
        }
    }
    
    showAddEventDialog(time) {
        if (window.eventModal) {
            window.eventModal.showAddDialog(time);
        }
    }
    
    updateMarkers() {
        if (!this.markersContainer) return;
        
        this.markersContainer.innerHTML = '';
        
        if (this.duration === 0) return;
        
        const width = this.markersContainer.clientWidth;
        const visibleDuration = this.duration / this.zoomLevel;
        
        let interval = 1;
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
    
    dispatchZoomEvent() {
        const event = new CustomEvent('sequence-zoom-change', { 
            detail: { zoomLevel: this.zoomLevel, scrollPosition: this.scrollPosition } 
        });
        this.container.dispatchEvent(event);
    }
    
    dispatchScrollEvent() {
        const event = new CustomEvent('sequence-scroll-change', { 
            detail: { zoomLevel: this.zoomLevel, scrollPosition: this.scrollPosition } 
        });
        this.container.dispatchEvent(event);
    }
    
    getEvents() {
        return this.events;
    }
    
    clearEvents() {
        this.events = [];
        this.needsFullRender = true;
        this.render();
        this.dispatchChangeEvent();
    }
}