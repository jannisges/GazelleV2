// Core SequenceEditor class for timeline visualization and event management
// Fully rewritten with device-based rows and expandable sub-rows

class SequenceEditor {
    // Constants
    static CONSTANTS = {
        MIN_ZOOM: 1,
        MAX_ZOOM: 100,
        MIN_EVENT_WIDTH: 20,
        DEFAULT_EVENT_DURATION: 2, // Changed to 2 seconds
        TRACK_HEIGHT: 40,
        SUB_TRACK_HEIGHT: 30,
        TRACK_PADDING: 2,
        THROTTLE_DELAY: 16, // 60 FPS
        MAX_VISIBLE_EVENTS: 1000,
        SCROLL_BUFFER: 0.1,
        ANIMATION_FPS: 30,
        ZOOM_FACTOR: 1.25
    };

    // Event colors by type
    static EVENT_COLORS = {
        dimmer: '#ffc107',
        color: '#28a745',
        position: '#6f42c1',
        default: '#007bff'
    };

    constructor(containerId, markersId) {
        // Core elements
        this.container = document.getElementById(containerId);
        this.markersContainer = document.getElementById(markersId);

        if (!this.container) {
            throw new Error(`Container element ${containerId} not found`);
        }

        // State
        this.state = {
            events: [],
            duration: 0,
            zoomLevel: 1,
            scrollPosition: 0,
            currentTime: 0,
            isPlaying: false,
            isExpanded: true, // Default to expanded view
            selectedEventIds: [], // Changed to array for multi-select
            expandedDevices: {}, // Track which devices are expanded
            patchedDevices: [] // Store patched devices info
        };

        // Clipboard for copy/paste
        this.clipboard = [];

        // Caches
        this.cache = {
            eventElements: new Map(),
            trackElements: new Map(),
            eventPool: [],
            lastRenderParams: null
        };

        // Flags
        this.flags = {
            needsFullRender: true,
            isDestroyed: false
        };

        // Animation
        this.animationFrameId = null;
        this.throttleTimeouts = new Map();

        // Initialize
        this.init();
    }

    init() {
        // Set initial expanded state
        this.container.classList.toggle('sequence-expanded', this.state.isExpanded);

        this.setupPlayheadOverlay();
        this.setupEventListeners();
        this.setupEventDelegation();
        this.setupKeyboardShortcuts();
    }

    setupPlayheadOverlay() {
        // Create overlay container
        this.playheadOverlay = document.createElement('div');
        Object.assign(this.playheadOverlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '10'
        });

        // Create playhead line
        this.playheadLine = document.createElement('div');
        Object.assign(this.playheadLine.style, {
            position: 'absolute',
            width: '2px',
            height: '100%',
            backgroundColor: '#dc3545',
            display: 'none',
            top: '0'
        });

        this.playheadOverlay.appendChild(this.playheadLine);
        this.container.appendChild(this.playheadOverlay);
    }

    setupEventListeners() {
        // Context menu for adding events
        this.boundContextMenu = this.handleContextMenu.bind(this);
        this.container.addEventListener('contextmenu', this.boundContextMenu);

        // Wheel for zoom
        this.boundWheel = this.throttle(this.handleWheel.bind(this),
            SequenceEditor.CONSTANTS.THROTTLE_DELAY);
        this.container.addEventListener('wheel', this.boundWheel, { passive: false });

        // Mouse events for drag scrolling
        this.setupDragScroll();

        // Resize observer
        this.resizeObserver = new ResizeObserver(
            this.throttle(this.handleResize.bind(this), 100)
        );
        this.resizeObserver.observe(this.container);
    }

    setupEventDelegation() {
        // Use event delegation instead of individual listeners
        this.boundClick = this.handleClick.bind(this);
        this.boundDoubleClick = this.handleDoubleClick.bind(this);

        // Use normal bubbling phase, not capture - let drag handlers work first
        this.container.addEventListener('click', this.boundClick, false);
        this.container.addEventListener('dblclick', this.boundDoubleClick, false);

        console.log('[EventDelegation] Event listeners attached to container');
    }

    setupKeyboardShortcuts() {
        // Global keyboard event handler
        this.boundKeyDown = this.handleKeyDown.bind(this);
        document.addEventListener('keydown', this.boundKeyDown);
    }

    handleKeyDown(e) {
        console.log('[KeyDown]', e.key, 'Ctrl:', e.ctrlKey, 'Selected:', this.state.selectedEventIds.length);

        // Delete key - delete selected events
        if (e.key === 'Delete' && this.state.selectedEventIds.length > 0) {
            e.preventDefault();
            console.log('[KeyDown] Delete pressed, deleting selected events');
            this.deleteSelectedEvents();
            return;
        }

        // Ctrl+C - copy selected events
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && this.state.selectedEventIds.length > 0) {
            // Don't prevent default if focus is in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            e.preventDefault();
            console.log('[KeyDown] Ctrl+C pressed, copying selected events');
            this.copySelectedEvents();
            return;
        }

        // Ctrl+V - paste events
        if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && this.clipboard.length > 0) {
            // Don't prevent default if focus is in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            e.preventDefault();
            console.log('[KeyDown] Ctrl+V pressed, pasting events');
            this.pasteEvents();
            return;
        }

        // Escape - deselect all
        if (e.key === 'Escape') {
            this.deselectAllEvents();
        }
    }

    setupDragScroll() {
        let isDragging = false;
        let lastX = 0;

        const handleMouseDown = (e) => {
            if (this.state.zoomLevel > 1 && !this.isEventElement(e.target)) {
                isDragging = true;
                lastX = e.clientX;
                this.container.style.cursor = 'grabbing';
                e.preventDefault();
            }
        };

        const handleMouseMove = this.throttle((e) => {
            if (!isDragging) return;

            const deltaX = e.clientX - lastX;
            const scrollDelta = -(deltaX / this.container.clientWidth) / this.state.zoomLevel;
            const maxScrollPosition = this.state.zoomLevel > 1 ? 1 : 0;
            const newScrollPosition = this.clamp(
                this.state.scrollPosition + scrollDelta,
                0,
                maxScrollPosition
            );

            if (newScrollPosition !== this.state.scrollPosition) {
                this.state.scrollPosition = newScrollPosition;
                lastX = e.clientX;
                this.scheduleRender();
                this.updateMarkers();
                this.updatePlayhead();
                this.dispatchEvent('scroll-change', {
                    zoomLevel: this.state.zoomLevel,
                    scrollPosition: this.state.scrollPosition
                });
            }
        }, SequenceEditor.CONSTANTS.THROTTLE_DELAY);

        const handleMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                this.container.style.cursor = 'default';
            }
        };

        this.boundMouseDown = handleMouseDown;
        this.boundMouseMove = handleMouseMove;
        this.boundMouseUp = handleMouseUp;

        this.container.addEventListener('mousedown', this.boundMouseDown);
        document.addEventListener('mousemove', this.boundMouseMove);
        document.addEventListener('mouseup', this.boundMouseUp);
        this.container.addEventListener('mouseleave', handleMouseUp);
    }

    // Event Handlers
    handleContextMenu(e) {
        e.preventDefault();

        // Calculate time from click position
        const rect = this.container.getBoundingClientRect();
        const time = this.pixelToTime(e.clientX - rect.left);

        // Get device from Y position if in expanded mode
        let deviceId = null;
        let subTrackType = null;

        if (this.state.isExpanded) {
            const clickY = e.clientY - rect.top + this.container.scrollTop;
            const trackInfo = this.getTrackFromY(clickY);
            deviceId = trackInfo.deviceId;
            subTrackType = trackInfo.subTrackType;
        }

        this.showAddEventDialog(time, deviceId, subTrackType);
    }

    getTrackFromY(y) {
        // Get all devices (same logic as renderExpandedTracks)
        const deviceGroups = this.groupEventsByDevice();
        const eventDeviceIds = Object.keys(deviceGroups);

        const allDeviceIds = new Set(eventDeviceIds);
        this.state.patchedDevices.forEach(device => {
            allDeviceIds.add(String(device.id));
        });

        const deviceIds = Array.from(allDeviceIds).sort((a, b) => Number(a) - Number(b));
        let currentY = 0;

        for (const deviceId of deviceIds) {
            const device = this.getDeviceInfo(deviceId);
            if (!device) continue;

            const isExpanded = this.state.expandedDevices[deviceId];
            const mainTrackHeight = SequenceEditor.CONSTANTS.TRACK_HEIGHT;

            if (y >= currentY && y < currentY + mainTrackHeight) {
                return { deviceId, subTrackType: null };
            }

            currentY += mainTrackHeight;

            if (isExpanded) {
                const subTracks = this.getDeviceSubTracks(device);

                for (const subTrack of subTracks) {
                    if (y >= currentY && y < currentY + SequenceEditor.CONSTANTS.SUB_TRACK_HEIGHT) {
                        return { deviceId, subTrackType: subTrack.type };
                    }
                    currentY += SequenceEditor.CONSTANTS.SUB_TRACK_HEIGHT;
                }
            }
        }

        return { deviceId: null, subTrackType: null };
    }

    handleWheel(e) {
        e.preventDefault();

        const rect = this.container.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) / rect.width;
        const mouseTime = this.pixelToTime(e.clientX - rect.left);

        const zoomFactor = e.deltaY > 0 ? 1 / SequenceEditor.CONSTANTS.ZOOM_FACTOR : SequenceEditor.CONSTANTS.ZOOM_FACTOR;
        const newZoomLevel = this.clamp(
            this.state.zoomLevel * zoomFactor,
            SequenceEditor.CONSTANTS.MIN_ZOOM,
            SequenceEditor.CONSTANTS.MAX_ZOOM
        );

        if (newZoomLevel !== this.state.zoomLevel) {
            this.state.zoomLevel = newZoomLevel;

            // Adjust scroll to keep mouse position stable
            const visibleDuration = this.getVisibleDuration();
            const targetTime = mouseTime - (mouseX * visibleDuration);
            const maxScroll = Math.max(0, this.state.duration - visibleDuration);
            this.state.scrollPosition = maxScroll > 0 ? this.clamp(targetTime / maxScroll, 0, 1) : 0;

            this.scheduleRender();
            this.updateMarkers();
            this.updatePlayhead();
            this.dispatchEvent('zoom-change', {
                zoomLevel: this.state.zoomLevel,
                scrollPosition: this.state.scrollPosition
            });
        }
    }

    handleClick(e) {
        console.log('[Container Click] Target:', e.target, 'classList:', e.target.classList);

        const eventElement = e.target.closest('.sequence-event');
        const trackHeader = e.target.closest('.track-header');
        const expandToggle = e.target.closest('.expand-toggle');

        console.log('[Container Click] eventElement:', eventElement, 'expandToggle:', expandToggle);

        // Handle expand/collapse toggle
        if (expandToggle) {
            e.stopPropagation();
            e.preventDefault();
            const deviceId = expandToggle.dataset.deviceId;
            console.log('[Container Click] Toggling device expansion for:', deviceId);
            this.toggleDeviceExpansion(deviceId);
            return;
        }

        // Handle track header clicks
        if (trackHeader) {
            return;
        }

        // Handle event selection - BUT events now have their own listeners
        // This should only fire if the event's handler didn't stopPropagation
        if (eventElement) {
            console.log('[Container Click] Event element found, but should be handled by direct listener');
            // Event's own click handler should have stopped propagation
            // If we reach here, something is wrong
            return;
        } else {
            // Click on empty space: deselect all
            console.log('[Container Click] Empty space clicked, deselecting all');
            this.deselectAllEvents();
        }
    }

    handleDoubleClick(e) {
        console.log('[DoubleClick] Target:', e.target);
        const eventElement = e.target.closest('.sequence-event');
        if (eventElement) {
            e.stopPropagation();
            e.preventDefault();
            const eventId = parseInt(eventElement.dataset.eventId);
            console.log('[DoubleClick] Editing event:', eventId);
            this.editEvent(eventId);
        }
    }

    handleResize() {
        this.flags.needsFullRender = true;
        this.scheduleRender();
        this.updateMarkers();
    }

    // Device Expansion
    toggleDeviceExpansion(deviceId) {
        this.state.expandedDevices[deviceId] = !this.state.expandedDevices[deviceId];
        this.flags.needsFullRender = true;
        this.scheduleRender();
    }

    getDeviceInfo(deviceId) {
        return this.state.patchedDevices.find(d => d.id === parseInt(deviceId));
    }

    getDeviceSubTracks(device) {
        if (!device || !device.device || !device.device.channels) {
            return [];
        }

        const tracks = [];
        const channelTypes = device.device.channels.map(ch => ch.type);

        // Check for dimmer
        if (channelTypes.includes('dimmer_channel')) {
            tracks.push({ type: 'dimmer', label: 'Dimmer' });
        }

        // Check for color (RGB)
        if (channelTypes.includes('red_channel') &&
            channelTypes.includes('green_channel') &&
            channelTypes.includes('blue_channel')) {
            tracks.push({ type: 'color', label: 'Color' });
        }

        // Check for position
        if (channelTypes.includes('pan') && channelTypes.includes('tilt')) {
            tracks.push({ type: 'position', label: 'Position' });
        }

        return tracks;
    }

    // Multi-select functionality
    selectEvent(eventId) {
        this.state.selectedEventIds = [eventId];
        this.updateSelectionUI();
    }

    toggleEventSelection(eventId) {
        const index = this.state.selectedEventIds.indexOf(eventId);
        if (index > -1) {
            this.state.selectedEventIds.splice(index, 1);
        } else {
            this.state.selectedEventIds.push(eventId);
        }
        this.updateSelectionUI();
    }

    deselectAllEvents() {
        this.state.selectedEventIds = [];
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        console.log('[Selection] Updating UI, selected IDs:', this.state.selectedEventIds);

        // Update all event elements to show/hide selection
        this.cache.eventElements.forEach((element, eventId) => {
            if (this.state.selectedEventIds.includes(eventId)) {
                element.classList.add('selected');
                console.log('[Selection] Added selected class to event:', eventId);

                // Update inner HTML to show action buttons
                const actionsDiv = element.querySelector('.event-actions');
                if (actionsDiv) {
                    actionsDiv.style.display = 'flex';
                }
            } else {
                element.classList.remove('selected');

                // Hide action buttons
                const actionsDiv = element.querySelector('.event-actions');
                if (actionsDiv) {
                    actionsDiv.style.display = 'none';
                }
            }
        });
    }

    // Copy/Paste functionality
    copySelectedEvents() {
        this.clipboard = this.state.selectedEventIds.map(id => {
            const event = this.state.events.find(e => e.id === id);
            return event ? { ...event } : null;
        }).filter(e => e !== null);

        console.log(`Copied ${this.clipboard.length} events`);
        this.showNotification(`Copied ${this.clipboard.length} event(s)`);
    }

    pasteEvents() {
        if (this.clipboard.length === 0) return;

        // Find the earliest time in clipboard
        const minTime = Math.min(...this.clipboard.map(e => e.time));

        // Paste at current playhead time or time 0
        const pasteTime = this.state.currentTime || 0;
        const timeOffset = pasteTime - minTime;

        // Create new events with adjusted times
        const newEvents = this.clipboard.map(event => {
            const newEvent = {
                ...event,
                id: Date.now() + Math.random(),
                time: event.time + timeOffset
            };
            return newEvent;
        });

        // Add all new events
        newEvents.forEach(event => {
            this.state.events.push(event);
        });

        this.sortEvents();
        this.flags.needsFullRender = true;
        this.scheduleRender();
        this.dispatchEvent('change', { events: this.state.events });

        // Select the newly pasted events
        this.state.selectedEventIds = newEvents.map(e => e.id);
        this.updateSelectionUI();

        console.log(`Pasted ${newEvents.length} events`);
        this.showNotification(`Pasted ${newEvents.length} event(s)`);
    }

    deleteSelectedEvents() {
        if (this.state.selectedEventIds.length === 0) return;

        const count = this.state.selectedEventIds.length;

        // Remove all selected events
        this.state.events = this.state.events.filter(
            e => !this.state.selectedEventIds.includes(e.id)
        );

        this.state.selectedEventIds = [];
        this.flags.needsFullRender = true;
        this.scheduleRender();
        this.dispatchEvent('change', { events: this.state.events });

        console.log(`Deleted ${count} events`);
        this.showNotification(`Deleted ${count} event(s)`);
    }

    showNotification(message, type = 'info') {
        // Create a simple toast notification
        const toast = document.createElement('div');
        toast.className = `alert alert-${type} position-fixed`;
        toast.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 250px;';
        toast.textContent = message;

        document.body.appendChild(toast);

        // Fade in
        setTimeout(() => {
            toast.style.opacity = '1';
        }, 10);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    // Public API
    loadSequence(events, duration) {
        this.state.events = Array.isArray(events) ? events : [];
        this.state.duration = duration || 0;
        this.flags.needsFullRender = true;
        this.scheduleRender();
        this.updateMarkers();
    }

    setPatchedDevices(devices) {
        this.state.patchedDevices = devices;

        // Initialize expanded state for all devices
        devices.forEach(device => {
            if (!(device.id in this.state.expandedDevices)) {
                this.state.expandedDevices[device.id] = false;
            }
        });

        this.flags.needsFullRender = true;
        this.scheduleRender();
    }

    addEvent(eventData) {
        const event = this.createEventObject(eventData);
        this.state.events.push(event);
        this.sortEvents();
        this.flags.needsFullRender = true;
        this.scheduleRender();
        this.dispatchEvent('change', { events: this.state.events });
        return event;
    }

    updateEvent(eventId, eventData) {
        const index = this.state.events.findIndex(e => e.id === eventId);
        if (index === -1) {
            console.warn(`Event ${eventId} not found`);
            return false;
        }

        this.state.events[index] = {
            ...this.state.events[index],
            ...eventData
        };
        this.sortEvents();
        this.flags.needsFullRender = true;
        this.scheduleRender();
        this.dispatchEvent('change', { events: this.state.events });
        return true;
    }

    removeEvent(eventId) {
        const index = this.state.events.findIndex(e => e.id === eventId);
        if (index === -1) {
            console.warn(`Event ${eventId} not found`);
            return false;
        }

        this.state.events.splice(index, 1);

        // Remove from selection if selected
        const selIndex = this.state.selectedEventIds.indexOf(eventId);
        if (selIndex > -1) {
            this.state.selectedEventIds.splice(selIndex, 1);
        }

        this.flags.needsFullRender = true;
        this.scheduleRender();
        this.dispatchEvent('change', { events: this.state.events });
        return true;
    }

    clearEvents() {
        this.state.events = [];
        this.state.selectedEventIds = [];
        this.flags.needsFullRender = true;
        this.scheduleRender();
        this.dispatchEvent('change', { events: this.state.events });
    }

    setZoomLevel(zoomLevel) {
        const newZoom = this.clamp(
            zoomLevel,
            SequenceEditor.CONSTANTS.MIN_ZOOM,
            SequenceEditor.CONSTANTS.MAX_ZOOM
        );

        if (newZoom !== this.state.zoomLevel) {
            this.state.zoomLevel = newZoom;
            this.flags.needsFullRender = true;
            this.scheduleRender();
            this.updateMarkers();
            this.updatePlayhead();
            this.dispatchEvent('zoom-change', {
                zoomLevel: this.state.zoomLevel,
                scrollPosition: this.state.scrollPosition
            });
        }
    }

    setScrollPosition(scrollPosition) {
        const maxScrollPosition = this.state.zoomLevel > 1 ? 1 : 0;
        const newScroll = this.clamp(scrollPosition, 0, maxScrollPosition);

        if (newScroll !== this.state.scrollPosition) {
            this.state.scrollPosition = newScroll;
            this.scheduleRender();
            this.updateMarkers();
            this.updatePlayhead();
            this.dispatchEvent('scroll-change', {
                zoomLevel: this.state.zoomLevel,
                scrollPosition: this.state.scrollPosition
            });
        }
    }

    setCurrentTime(time) {
        this.state.currentTime = time;
        this.updatePlayhead();
    }

    setPlaying(isPlaying) {
        this.state.isPlaying = isPlaying;
    }

    setExpanded(expanded) {
        if (this.state.isExpanded !== expanded) {
            this.state.isExpanded = expanded;
            this.container.classList.toggle('sequence-expanded', expanded);
            this.flags.needsFullRender = true;
            this.scheduleRender();
        }
    }

    setDuration(duration) {
        if (this.state.duration !== duration) {
            this.state.duration = duration;
            this.updateMarkers();
        }
    }

    syncFromExternal(zoomLevel, scrollPosition) {
        const zoomChanged = this.state.zoomLevel !== zoomLevel;

        this.state.zoomLevel = this.clamp(
            zoomLevel,
            SequenceEditor.CONSTANTS.MIN_ZOOM,
            SequenceEditor.CONSTANTS.MAX_ZOOM
        );

        const maxScrollPosition = this.state.zoomLevel > 1 ? 1 : 0;
        this.state.scrollPosition = this.clamp(scrollPosition, 0, maxScrollPosition);

        if (zoomChanged || !this.state.isPlaying) {
            this.flags.needsFullRender = true;
            this.scheduleRender();
            this.updateMarkers();
        }
        this.updatePlayhead();
    }

    getEvents() {
        return [...this.state.events];
    }

    // Rendering
    scheduleRender() {
        if (this.flags.isDestroyed) return;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        this.animationFrameId = requestAnimationFrame(() => {
            this.render();
            this.animationFrameId = null;
        });
    }

    render() {
        if (this.flags.isDestroyed) return;

        if (this.shouldFullRender()) {
            this.renderFull();
            this.flags.needsFullRender = false;
        } else {
            this.renderIncremental();
        }
    }

    shouldFullRender() {
        const currentParams = {
            zoomLevel: this.state.zoomLevel,
            scrollPosition: this.state.scrollPosition,
            duration: this.state.duration,
            eventsCount: this.state.events.length,
            isExpanded: this.state.isExpanded,
            expandedDevices: JSON.stringify(this.state.expandedDevices),
            containerWidth: this.container.clientWidth,
            containerHeight: this.container.clientHeight
        };

        if (!this.cache.lastRenderParams) {
            this.cache.lastRenderParams = currentParams;
            return true;
        }

        const needsRender = Object.keys(currentParams).some(
            key => this.cache.lastRenderParams[key] !== currentParams[key]
        );

        if (needsRender) {
            this.cache.lastRenderParams = currentParams;
        }

        return needsRender || this.flags.needsFullRender;
    }

    renderFull() {
        // Save playhead overlay
        const playheadOverlay = this.playheadOverlay;
        if (playheadOverlay?.parentNode === this.container) {
            this.container.removeChild(playheadOverlay);
        }

        // Clear container
        this.clearContainer();

        // Clear caches
        this.cache.eventElements.clear();
        this.cache.trackElements.clear();

        // Create document fragment for batch DOM operations
        const fragment = document.createDocumentFragment();

        // Render tracks
        this.renderTracks(fragment);

        // Render events
        this.renderEvents(fragment);

        // Append fragment to container
        this.container.appendChild(fragment);

        // Restore playhead overlay
        if (playheadOverlay) {
            this.container.appendChild(playheadOverlay);
        }
    }

    renderIncremental() {
        // Only update positions of existing elements
        this.updateEventPositions();
    }

    renderTracks(fragment) {
        if (this.state.isExpanded) {
            this.renderExpandedTracks(fragment);
        } else {
            this.renderCollapsedTrack(fragment);
        }
    }

    renderExpandedTracks(fragment) {
        // Get all unique devices - from both events and patchedDevices
        const deviceGroups = this.groupEventsByDevice();
        const eventDeviceIds = Object.keys(deviceGroups);

        // Include all patched devices even if they don't have events yet
        const allDeviceIds = new Set(eventDeviceIds);
        this.state.patchedDevices.forEach(device => {
            allDeviceIds.add(String(device.id));
        });

        const deviceIds = Array.from(allDeviceIds).sort((a, b) => Number(a) - Number(b));
        let currentY = 0;

        console.log('[RenderTracks] Rendering', deviceIds.length, 'devices');

        deviceIds.forEach((deviceId) => {
            const device = this.getDeviceInfo(deviceId);

            // Skip if device info not found
            if (!device) {
                console.log('[RenderTracks] Device not found:', deviceId);
                return;
            }

            const isExpanded = this.state.expandedDevices[deviceId];
            console.log('[RenderTracks] Device', deviceId, 'expanded:', isExpanded);

            // Main device track
            const track = this.createDeviceTrackElement(deviceId, device, currentY, isExpanded);
            this.cache.trackElements.set(deviceId, track);
            fragment.appendChild(track);

            currentY += SequenceEditor.CONSTANTS.TRACK_HEIGHT;

            // Sub-tracks if expanded
            if (isExpanded) {
                const subTracks = this.getDeviceSubTracks(device);
                console.log('[RenderTracks] Device', deviceId, 'has', subTracks.length, 'sub-tracks');
                subTracks.forEach((subTrack) => {
                    const subTrackElement = this.createSubTrackElement(
                        deviceId,
                        subTrack,
                        currentY
                    );
                    fragment.appendChild(subTrackElement);
                    currentY += SequenceEditor.CONSTANTS.SUB_TRACK_HEIGHT;
                });
            }
        });

        console.log('[RenderTracks] Total height:', currentY);
        this.container.style.height = `${currentY}px`;
    }

    renderCollapsedTrack(fragment) {
        const track = this.createTrackElement('main', 0);
        this.cache.trackElements.set('main', track);
        fragment.appendChild(track);
        this.container.style.height = '';
    }

    createDeviceTrackElement(deviceId, device, y, isExpanded) {
        const track = document.createElement('div');
        track.className = 'sequence-track device-track';
        track.style.top = `${y}px`;
        track.style.height = `${SequenceEditor.CONSTANTS.TRACK_HEIGHT}px`;
        track.dataset.deviceId = deviceId;

        const header = document.createElement('div');
        header.className = 'track-header';
        header.style.pointerEvents = 'auto'; // Ensure it receives clicks
        header.style.zIndex = '100'; // Make sure it's above other elements

        const expandIcon = document.createElement('span');
        expandIcon.className = 'expand-toggle';
        expandIcon.dataset.deviceId = deviceId;
        expandIcon.innerHTML = isExpanded ? '&#9660;' : '&#9658;'; // ▼ or ▶
        expandIcon.style.cursor = 'pointer';
        expandIcon.style.marginRight = '8px';
        expandIcon.style.fontSize = '14px';
        expandIcon.style.fontWeight = 'bold';
        expandIcon.style.display = 'inline-block';
        expandIcon.style.width = '16px';
        expandIcon.style.textAlign = 'center';
        expandIcon.style.userSelect = 'none';

        const label = document.createElement('span');
        label.className = 'track-label';
        label.textContent = device ? device.device.name : `Device ${deviceId}`;
        label.style.fontWeight = '600';

        header.appendChild(expandIcon);
        header.appendChild(label);
        track.appendChild(header);

        console.log('[Track] Created device track for:', deviceId, 'expanded:', isExpanded);

        return track;
    }

    createSubTrackElement(deviceId, subTrack, y) {
        const track = document.createElement('div');
        track.className = 'sequence-track sub-track';
        track.style.top = `${y}px`;
        track.style.height = `${SequenceEditor.CONSTANTS.SUB_TRACK_HEIGHT}px`;
        track.dataset.deviceId = deviceId;
        track.dataset.subTrackType = subTrack.type;

        const label = document.createElement('div');
        label.className = 'sub-track-label';
        label.textContent = subTrack.label;
        label.style.paddingLeft = '30px';
        label.style.fontSize = '11px';
        label.style.color = '#999';

        track.appendChild(label);

        return track;
    }

    createTrackElement(deviceId, index) {
        const track = document.createElement('div');
        track.className = 'sequence-track';
        track.style.top = `${index * SequenceEditor.CONSTANTS.TRACK_HEIGHT}px`;
        track.dataset.deviceId = deviceId;

        if (deviceId !== 'main') {
            const label = document.createElement('div');
            label.className = 'track-label';
            label.textContent = `Device ${deviceId}`;
            Object.assign(label.style, {
                position: 'absolute',
                left: '5px',
                top: '5px',
                fontSize: '12px',
                color: '#6c757d'
            });
            track.appendChild(label);
        }

        return track;
    }

    renderEvents(fragment) {
        const visibleRange = this.getVisibleTimeRange();
        const visibleEvents = this.state.events.filter(event =>
            this.isEventVisible(event, visibleRange)
        );

        // Limit for performance
        const eventsToRender = visibleEvents.slice(
            0,
            SequenceEditor.CONSTANTS.MAX_VISIBLE_EVENTS
        );

        eventsToRender.forEach(event => {
            const element = this.createEventElement(event);
            this.cache.eventElements.set(event.id, element);
            fragment.appendChild(element);
        });
    }

    createEventElement(event) {
        // Reuse from pool if available
        let element = this.cache.eventPool.pop();
        if (!element) {
            element = document.createElement('div');
            element.className = 'sequence-event';
        }

        element.dataset.eventId = event.id;

        // Update position and size
        const x = this.timeToPixel(event.time);
        const eventDuration = event.duration || SequenceEditor.CONSTANTS.DEFAULT_EVENT_DURATION;
        const durationWidth = this.getDurationWidth(eventDuration);
        const width = Math.max(SequenceEditor.CONSTANTS.MIN_EVENT_WIDTH, durationWidth);
        const y = this.getEventY(event);

        Object.assign(element.style, {
            left: `${x}px`,
            width: `${width}px`,
            top: `${y}px`,
            backgroundColor: this.getEventColor(event)
        });

        // Set content
        element.innerHTML = this.getEventHTML(event);

        // Add selected class if needed
        if (this.state.selectedEventIds.includes(event.id)) {
            element.classList.add('selected');
        } else {
            element.classList.remove('selected');
        }

        // Make draggable and resizable
        this.makeEventDraggable(element, event);

        return element;
    }

    getEventHTML(event) {
        const isSelected = this.state.selectedEventIds.includes(event.id);

        return `
            <div class="event-resize-handle event-resize-left"></div>
            <span class="event-label">${this.escapeHtml(event.type)}</span>
            <div class="event-actions" style="display: ${isSelected ? 'flex' : 'none'};">
                <button class="btn btn-sm btn-outline-light event-edit-btn" data-event-id="${event.id}" onclick="window.sequenceEditor.editEvent(${event.id}); event.stopPropagation();">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-light event-delete-btn" data-event-id="${event.id}" onclick="if(confirm('Delete this event?')) { window.sequenceEditor.removeEvent(${event.id}); } event.stopPropagation();">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
            <div class="event-resize-handle event-resize-right"></div>
        `;
    }

    updateEventPositions() {
        this.cache.eventElements.forEach((element, eventId) => {
            const event = this.state.events.find(e => e.id === eventId);
            if (!event) {
                // Event was deleted, return element to pool
                element.remove();
                this.cache.eventElements.delete(eventId);
                this.cache.eventPool.push(element);
                return;
            }

            const x = this.timeToPixel(event.time);
            const eventDuration = event.duration || SequenceEditor.CONSTANTS.DEFAULT_EVENT_DURATION;
            const durationWidth = this.getDurationWidth(eventDuration);
            const width = Math.max(SequenceEditor.CONSTANTS.MIN_EVENT_WIDTH, durationWidth);
            const y = this.getEventY(event);

            element.style.left = `${x}px`;
            element.style.width = `${width}px`;
            element.style.top = `${y}px`;
        });
    }

    makeEventDraggable(element, event) {
        let dragMode = null; // 'move', 'resize-left', 'resize-right'
        let isDragging = false;
        let hasMoved = false; // Track if mouse actually moved
        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let startDuration = 0;
        let draggedEvents = []; // Track all events being dragged
        let startTimes = new Map(); // Store original times for all dragged events
        const DRAG_THRESHOLD = 3; // pixels before considering it a drag

        const handleMouseDown = (e) => {
            // Don't drag if clicking on buttons
            if (e.target.closest('.event-actions button')) return;

            // Determine drag mode
            if (e.target.classList.contains('event-resize-left')) {
                dragMode = 'resize-left';
            } else if (e.target.classList.contains('event-resize-right')) {
                dragMode = 'resize-right';
            } else if (!e.target.closest('.event-actions')) {
                dragMode = 'move';
            } else {
                return;
            }

            // If resizing, only allow single event
            if (dragMode !== 'move') {
                draggedEvents = [event];
            } else {
                // If this event is selected, drag all selected events
                if (this.state.selectedEventIds.includes(event.id)) {
                    draggedEvents = this.state.events.filter(e =>
                        this.state.selectedEventIds.includes(e.id)
                    );
                    console.log('[Drag] Multi-drag:', draggedEvents.length, 'events');
                } else {
                    // Only drag this single event
                    draggedEvents = [event];
                }
            }

            isDragging = true;
            hasMoved = false; // Reset movement flag
            startX = e.clientX;
            startY = e.clientY;
            startTime = event.time;
            startDuration = event.duration || SequenceEditor.CONSTANTS.DEFAULT_EVENT_DURATION;

            // Store start times for all dragged events
            startTimes.clear();
            draggedEvents.forEach(e => {
                startTimes.set(e.id, e.time);
            });

            // DON'T stopPropagation or preventDefault here - let click/dblclick through
        };

        const handleMouseMove = (e) => {
            if (!isDragging) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            // Check if we've moved beyond threshold
            if (!hasMoved && distance > DRAG_THRESHOLD) {
                hasMoved = true;

                // Apply dragging styles to all dragged events
                draggedEvents.forEach(evt => {
                    const el = this.cache.eventElements.get(evt.id);
                    if (el) {
                        el.style.opacity = '0.7';
                        el.style.zIndex = '1000';
                        if (dragMode === 'move') {
                            el.style.cursor = 'grabbing';
                        }
                    }
                });
            }

            if (!hasMoved) return; // Don't update position until threshold exceeded

            const deltaTime = this.pixelToTime(deltaX) - this.pixelToTime(0);

            if (dragMode === 'move') {
                // Move all selected events together
                draggedEvents.forEach(evt => {
                    const el = this.cache.eventElements.get(evt.id);
                    if (!el) return;

                    const evtStartTime = startTimes.get(evt.id);
                    const evtDuration = evt.duration || SequenceEditor.CONSTANTS.DEFAULT_EVENT_DURATION;

                    // Calculate new time with boundary checking
                    let newTime = evtStartTime + deltaTime;
                    newTime = Math.max(0, newTime); // Don't go before 0
                    newTime = Math.min(this.state.duration - evtDuration, newTime); // Don't go past end

                    el.style.left = `${this.timeToPixel(newTime)}px`;
                });

            } else if (dragMode === 'resize-left') {
                // Resize from the left (single event only)
                const newTime = Math.max(0, Math.min(startTime + startDuration - 0.1, startTime + deltaTime));
                const newDuration = Math.max(0.1, startDuration - (newTime - startTime));

                const x = this.timeToPixel(newTime);
                const width = Math.max(SequenceEditor.CONSTANTS.MIN_EVENT_WIDTH, this.getDurationWidth(newDuration));

                element.style.left = `${x}px`;
                element.style.width = `${width}px`;

            } else if (dragMode === 'resize-right') {
                // Resize from the right (single event only)
                const newDuration = Math.max(0.1, Math.min(this.state.duration - startTime, startDuration + deltaTime));
                const width = Math.max(SequenceEditor.CONSTANTS.MIN_EVENT_WIDTH, this.getDurationWidth(newDuration));

                element.style.width = `${width}px`;
            }
        };

        const handleMouseUp = (e) => {
            if (!isDragging) return;

            // If we actually dragged (moved beyond threshold), update the events
            if (hasMoved) {
                // Reset styles for all dragged events
                draggedEvents.forEach(evt => {
                    const el = this.cache.eventElements.get(evt.id);
                    if (el) {
                        el.style.opacity = '1';
                        el.style.zIndex = '';
                        el.style.cursor = '';
                    }
                });

                const deltaX = e.clientX - startX;
                const deltaTime = this.pixelToTime(deltaX) - this.pixelToTime(0);

                if (dragMode === 'move') {
                    // Update all dragged events
                    console.log('[Drag] Updating', draggedEvents.length, 'events');
                    draggedEvents.forEach(evt => {
                        const evtStartTime = startTimes.get(evt.id);
                        const evtDuration = evt.duration || SequenceEditor.CONSTANTS.DEFAULT_EVENT_DURATION;

                        let newTime = evtStartTime + deltaTime;
                        newTime = Math.max(0, newTime);
                        newTime = Math.min(this.state.duration - evtDuration, newTime);

                        this.updateEvent(evt.id, { time: newTime });
                    });

                } else if (dragMode === 'resize-left') {
                    const newTime = Math.max(0, Math.min(startTime + startDuration - 0.1, startTime + deltaTime));
                    const newDuration = Math.max(0.1, startDuration - (newTime - startTime));
                    this.updateEvent(event.id, { time: newTime, duration: newDuration });

                } else if (dragMode === 'resize-right') {
                    const newDuration = Math.max(0.1, Math.min(this.state.duration - startTime, startDuration + deltaTime));
                    this.updateEvent(event.id, { duration: newDuration });
                }
            }
            // If we didn't move (just clicked), the click/dblclick handlers will fire naturally

            isDragging = false;
            hasMoved = false;
            dragMode = null;
            draggedEvents = [];
            startTimes.clear();
        };

        const handleMouseEnter = (e) => {
            if (e.target.classList.contains('event-resize-left') ||
                e.target.classList.contains('event-resize-right')) {
                e.target.style.cursor = 'ew-resize';
            }
        };

        // Direct click and double-click handlers on the element
        const handleClick = (e) => {
            console.log('[Event Click] Clicked on event:', event.id, 'hasMoved:', hasMoved);

            // Don't handle click if we just dragged
            if (hasMoved) {
                console.log('[Event Click] Ignoring - was a drag');
                return;
            }

            // Don't handle if clicking action buttons
            if (e.target.closest('.event-actions') || e.target.closest('.event-edit-btn') || e.target.closest('.event-delete-btn')) {
                console.log('[Event Click] Ignoring - action button');
                return;
            }

            // Use event.id directly - don't parse it
            const eventId = event.id;
            console.log('[Event Click] Processing click, eventId:', eventId, 'Ctrl:', e.ctrlKey);

            if (e.ctrlKey || e.metaKey) {
                this.toggleEventSelection(eventId);
            } else {
                this.selectEvent(eventId);
            }
            e.stopPropagation(); // Stop bubbling to container
            e.preventDefault(); // Prevent default to avoid double-firing
        };

        const handleDoubleClick = (e) => {
            console.log('[Event DblClick] Double-clicked on event:', event.id, 'hasMoved:', hasMoved);

            // Don't handle double-click if we just dragged
            if (hasMoved) {
                console.log('[Event DblClick] Ignoring - was a drag');
                return;
            }

            // Don't handle if clicking action buttons
            if (e.target.closest('.event-actions') || e.target.closest('.event-edit-btn') || e.target.closest('.event-delete-btn')) {
                return;
            }

            // Use event.id directly - don't parse it
            const eventId = event.id;
            console.log('[Event DblClick] Opening edit modal for:', eventId);
            this.editEvent(eventId);
            e.stopPropagation(); // Stop bubbling to container
            e.preventDefault(); // Prevent default
        };

        element.addEventListener('click', handleClick);
        element.addEventListener('dblclick', handleDoubleClick);
        element.addEventListener('mousedown', handleMouseDown);
        element.addEventListener('mouseenter', handleMouseEnter, true);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // Store cleanup function
        element._cleanup = () => {
            element.removeEventListener('click', handleClick);
            element.removeEventListener('dblclick', handleDoubleClick);
            element.removeEventListener('mousedown', handleMouseDown);
            element.removeEventListener('mouseenter', handleMouseEnter, true);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }

    updatePlayhead() {
        if (!this.playheadLine) return;

        if (this.state.currentTime > 0) {
            const x = this.timeToPixel(this.state.currentTime);
            const containerWidth = this.container.clientWidth;

            if (x >= 0 && x <= containerWidth) {
                this.playheadLine.style.display = 'block';
                this.playheadLine.style.left = `${x}px`;
            } else {
                this.playheadLine.style.display = 'none';
            }
        } else {
            this.playheadLine.style.display = 'none';
        }
    }

    updateMarkers() {
        if (!this.markersContainer) return;

        this.markersContainer.innerHTML = '';

        if (this.state.duration === 0) return;

        const visibleDuration = this.getVisibleDuration();
        const interval = this.getMarkerInterval(visibleDuration);
        const { start: startTime, end: endTime } = this.getVisibleTimeRange();

        for (let time = Math.ceil(startTime / interval) * interval; time <= endTime; time += interval) {
            const x = this.timeToPixel(time);
            const width = this.markersContainer.clientWidth;

            if (x >= 0 && x <= width) {
                const marker = this.createMarker(time, x, interval);
                this.markersContainer.appendChild(marker);
            }
        }
    }

    createMarker(time, x, interval) {
        const marker = document.createElement('div');
        marker.className = 'timeline-marker';
        marker.style.left = `${x}px`;

        const majorInterval = interval >= 1 ? interval * 5 : interval * 10;
        const isMajor = Math.abs(time % majorInterval) < 0.001;

        if (isMajor) {
            marker.classList.add('major');

            const label = document.createElement('div');
            label.className = 'timeline-label';
            label.textContent = this.formatTime(time);
            label.style.left = `${x}px`;
            this.markersContainer.appendChild(label);
        }

        return marker;
    }

    getMarkerInterval(visibleDuration) {
        if (visibleDuration > 600) return 60;
        if (visibleDuration > 300) return 30;
        if (visibleDuration > 120) return 10;
        if (visibleDuration > 60) return 5;
        if (visibleDuration > 30) return 2;
        if (visibleDuration > 10) return 1;
        if (visibleDuration > 5) return 0.5;
        return 0.1;
    }

    // Event Management
    editEvent(eventId) {
        const event = this.state.events.find(e => e.id === eventId);
        if (!event) {
            console.warn(`Event ${eventId} not found`);
            return;
        }

        if (window.eventModal) {
            window.eventModal.editEvent(event);
        } else {
            console.warn('Event modal not available');
        }
    }

    showAddEventDialog(time, deviceId, subTrackType) {
        if (window.eventModal) {
            window.eventModal.showAddDialog(time, deviceId, subTrackType);
        } else {
            console.warn('Event modal not available');
        }
    }

    // Helper Methods
    createEventObject(eventData) {
        return {
            id: eventData.id || Date.now() + Math.random(),
            time: eventData.time || 0,
            device_id: eventData.device_id,
            type: eventData.type || 'unknown',
            value: eventData.value,
            color: eventData.color || null,
            duration: eventData.duration || SequenceEditor.CONSTANTS.DEFAULT_EVENT_DURATION
        };
    }

    sortEvents() {
        this.state.events.sort((a, b) => a.time - b.time);
    }

    groupEventsByDevice() {
        const groups = {};
        this.state.events.forEach(event => {
            if (!groups[event.device_id]) {
                groups[event.device_id] = [];
            }
            groups[event.device_id].push(event);
        });
        return groups;
    }

    getEventY(event) {
        if (!this.state.isExpanded) {
            return SequenceEditor.CONSTANTS.TRACK_PADDING;
        }

        // Get all devices (same logic as renderExpandedTracks)
        const deviceGroups = this.groupEventsByDevice();
        const eventDeviceIds = Object.keys(deviceGroups);

        const allDeviceIds = new Set(eventDeviceIds);
        this.state.patchedDevices.forEach(device => {
            allDeviceIds.add(String(device.id));
        });

        const deviceIds = Array.from(allDeviceIds).sort((a, b) => Number(a) - Number(b));
        let currentY = 0;

        for (const deviceId of deviceIds) {
            if (String(event.device_id) === String(deviceId)) {
                // Check if we need to place in a sub-track
                if (this.state.expandedDevices[deviceId]) {
                    const device = this.getDeviceInfo(deviceId);
                    const subTracks = this.getDeviceSubTracks(device);

                    // Find matching sub-track
                    let subTrackIndex = subTracks.findIndex(st => st.type === event.type);
                    if (subTrackIndex !== -1) {
                        return currentY + SequenceEditor.CONSTANTS.TRACK_HEIGHT +
                               (subTrackIndex * SequenceEditor.CONSTANTS.SUB_TRACK_HEIGHT) +
                               SequenceEditor.CONSTANTS.TRACK_PADDING;
                    }
                }

                // Place in main device track
                return currentY + SequenceEditor.CONSTANTS.TRACK_PADDING;
            }

            currentY += SequenceEditor.CONSTANTS.TRACK_HEIGHT;

            const device = this.getDeviceInfo(deviceId);
            if (device && this.state.expandedDevices[deviceId]) {
                const subTracks = this.getDeviceSubTracks(device);
                currentY += subTracks.length * SequenceEditor.CONSTANTS.SUB_TRACK_HEIGHT;
            }
        }

        return SequenceEditor.CONSTANTS.TRACK_PADDING;
    }

    getEventColor(event) {
        if (event.type === 'color' && event.color) {
            return event.color;
        }
        return SequenceEditor.EVENT_COLORS[event.type] || SequenceEditor.EVENT_COLORS.default;
    }

    getVisibleDuration() {
        return this.state.duration / this.state.zoomLevel;
    }

    getVisibleTimeRange() {
        const visibleDuration = this.getVisibleDuration();
        const startTime = this.state.scrollPosition * (this.state.duration - visibleDuration);
        const endTime = startTime + visibleDuration;
        const buffer = visibleDuration * SequenceEditor.CONSTANTS.SCROLL_BUFFER;

        return {
            start: Math.max(0, startTime - buffer),
            end: Math.min(this.state.duration, endTime + buffer)
        };
    }

    isEventVisible(event, visibleRange) {
        const eventEnd = event.time + (event.duration || SequenceEditor.CONSTANTS.DEFAULT_EVENT_DURATION);
        return event.time <= visibleRange.end && eventEnd >= visibleRange.start;
    }

    timeToPixel(time) {
        if (this.state.duration === 0) return 0;

        const visibleDuration = this.getVisibleDuration();
        const startTime = this.state.scrollPosition * (this.state.duration - visibleDuration);

        return ((time - startTime) / visibleDuration) * this.container.clientWidth;
    }

    pixelToTime(pixel) {
        const visibleDuration = this.getVisibleDuration();
        const startTime = this.state.scrollPosition * (this.state.duration - visibleDuration);

        return startTime + (pixel / this.container.clientWidth) * visibleDuration;
    }

    getDurationWidth(duration) {
        if (this.state.duration === 0) return 0;

        const visibleDuration = this.getVisibleDuration();
        return (duration / visibleDuration) * this.container.clientWidth;
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);

        if (seconds < 10 && seconds % 1 !== 0) {
            return `${seconds.toFixed(1)}s`;
        }

        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    // Utility Methods
    throttle(func, delay) {
        let timeoutId = null;
        let lastArgs = null;

        return (...args) => {
            lastArgs = args;

            if (!timeoutId) {
                timeoutId = setTimeout(() => {
                    func.apply(this, lastArgs);
                    timeoutId = null;
                }, delay);
            }
        };
    }

    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    isEventElement(element) {
        return element.classList.contains('sequence-event') ||
               element.closest('.sequence-event');
    }

    clearContainer() {
        // Clean up event elements before clearing
        this.cache.eventElements.forEach(element => {
            if (element._cleanup) {
                element._cleanup();
            }
        });

        while (this.container.firstChild) {
            if (this.container.firstChild !== this.playheadOverlay) {
                this.container.removeChild(this.container.firstChild);
            } else {
                break;
            }
        }
    }

    dispatchEvent(eventName, detail = {}) {
        const event = new CustomEvent(`sequence-${eventName}`, { detail });
        this.container.dispatchEvent(event);
    }

    // Cleanup
    destroy() {
        this.flags.isDestroyed = true;

        // Cancel pending animations
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        // Clear throttle timeouts
        this.throttleTimeouts.forEach(timeout => clearTimeout(timeout));
        this.throttleTimeouts.clear();

        // Remove event listeners
        this.container.removeEventListener('contextmenu', this.boundContextMenu);
        this.container.removeEventListener('wheel', this.boundWheel);
        this.container.removeEventListener('click', this.boundClick);
        this.container.removeEventListener('dblclick', this.boundDoubleClick);
        this.container.removeEventListener('mousedown', this.boundMouseDown);
        document.removeEventListener('mousemove', this.boundMouseMove);
        document.removeEventListener('mouseup', this.boundMouseUp);
        document.removeEventListener('keydown', this.boundKeyDown);

        // Disconnect resize observer
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        // Clean up cached elements
        this.clearContainer();
        this.cache.eventElements.clear();
        this.cache.trackElements.clear();
        this.cache.eventPool = [];
    }
}

// Global helper functions for inline event handlers (backwards compatibility)
function editEventFromElement(eventId) {
    if (window.sequenceEditor) {
        window.sequenceEditor.editEvent(eventId);
    }
}

function deleteEventFromElement(eventId) {
    if (window.sequenceEditor) {
        if (confirm('Are you sure you want to delete this event?')) {
            window.sequenceEditor.removeEvent(eventId);
        }
    }
}
