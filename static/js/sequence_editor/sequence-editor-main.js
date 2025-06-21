// Main sequence editor initialization and coordination
class SequenceEditorApp {
    constructor() {
        this.sequenceEditor = null;
        this.playbackController = null;
        this.uiManager = null;
        this.eventModal = null;
        
        this.initialize();
    }
    
    initialize() {
        // Initialize components in order
        this.uiManager = new UIManager();
        this.playbackController = new PlaybackController();
        this.eventModal = new EventModal();
        
        // Make components globally accessible
        window.uiManager = this.uiManager;
        window.playbackController = this.playbackController;
        window.eventModal = this.eventModal;
        
        // Initialize sequence editor if container exists
        this.initializeSequenceEditor();
        
        // Load initial data
        this.loadInitialData();
        
        // Setup cross-component communication
        this.setupCommunication();
        
        console.log('Sequence editor app initialized');
    }
    
    initializeSequenceEditor() {
        const sequenceContainer = document.getElementById('sequenceContainer');
        if (sequenceContainer) {
            this.sequenceEditor = new SequenceEditor('sequenceContainer', 'sequenceMarkers');
            window.sequenceEditor = this.sequenceEditor;
            
            // Listen for sequence changes
            sequenceContainer.addEventListener('sequence-change', (e) => {
                this.uiManager.currentSequence.events = e.detail.events;
                this.playbackController.setCurrentSequence(this.uiManager.currentSequence);
            });
            
            // Set up synchronization with waveform (if it exists)
            if (window.setupTimelineSync) {
                window.setupTimelineSync();
            }
        }
    }
    
    loadInitialData() {
        // Load patched devices
        this.uiManager.loadPatchedDevices();
    }
    
    setupCommunication() {
        // Setup communication between components
        
        // When a song is loaded, update all components
        const originalSetCurrentSong = this.uiManager.setCurrentSong.bind(this.uiManager);
        this.uiManager.setCurrentSong = (song) => {
            originalSetCurrentSong(song);
            this.playbackController.setCurrentSong(song);
        };
        
        // When sequence changes, update playback controller
        const originalSetCurrentSequence = this.uiManager.setCurrentSequence.bind(this.uiManager);
        this.uiManager.setCurrentSequence = (sequence) => {
            originalSetCurrentSequence(sequence);
            this.playbackController.setCurrentSequence(sequence);
        };
        
        // When devices are loaded, update event modal
        const originalSetPatchedDevices = this.uiManager.setPatchedDevices.bind(this.uiManager);
        this.uiManager.setPatchedDevices = (devices) => {
            originalSetPatchedDevices(devices);
            this.eventModal.setPatchedDevices(devices);
        };
    }
}

// Backward compatibility functions
function initializeSequenceEditor() {
    if (document.getElementById('sequenceContainer')) {
        window.sequenceEditor = new SequenceEditor('sequenceContainer', 'sequenceMarkers');
        
        // Listen for sequence changes
        document.getElementById('sequenceContainer').addEventListener('sequence-change', (e) => {
            if (window.uiManager) {
                window.uiManager.currentSequence.events = e.detail.events;
            }
        });
        
        // Set up synchronization with waveform (if it exists)
        if (window.setupTimelineSync) {
            window.setupTimelineSync();
        }
    }
}

function renderSequence() {
    if (window.sequenceEditor && window.uiManager && window.uiManager.currentSong) {
        window.sequenceEditor.loadSequence(
            window.uiManager.currentSequence.events, 
            window.uiManager.currentSong.duration
        );
    }
}

function seekToPosition(time) {
    if (window.playbackController) {
        window.playbackController.seekToPosition(time);
    }
}

function playSequence() {
    if (window.playbackController) {
        window.playbackController.playSequence();
    }
}

function stopSequence() {
    if (window.playbackController) {
        window.playbackController.stopSequence();
    }
}

function saveSequence() {
    if (window.uiManager) {
        window.uiManager.saveSequence();
    }
}

function toggleSequenceExpanded() {
    if (window.uiManager) {
        window.uiManager.toggleSequenceExpanded();
    }
}

function addSequenceEvent() {
    if (window.uiManager) {
        window.uiManager.addSequenceEvent();
    }
}

function saveEvent() {
    if (window.eventModal) {
        window.eventModal.saveEvent();
    }
}

// Legacy global variables for backward compatibility
let currentSong = null;
let currentSequence = { events: [] };
let isExpanded = false;
let patchedDevices = [];

// Legacy functions that delegate to new system
function updateSongInfo() {
    if (window.uiManager && window.uiManager.currentSong) {
        currentSong = window.uiManager.currentSong;
        window.uiManager.updateSongInfo();
    }
}

function loadPatchedDevices() {
    if (window.uiManager) {
        window.uiManager.loadPatchedDevices();
    }
}

function updateDeviceList() {
    if (window.uiManager) {
        window.uiManager.updateDeviceList();
    }
}

function handleFileUpload(input) {
    if (window.uiManager) {
        window.uiManager.handleFileUpload(input);
    }
}

function openFileDialog() {
    if (window.uiManager) {
        window.uiManager.openFileDialog();
    }
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize waveform first (if exists)
    if (window.initializeWaveform) {
        window.initializeWaveform();
    }
    
    // Initialize the main app
    window.sequenceEditorApp = new SequenceEditorApp();
});

// Legacy initialization function for backward compatibility
function setupEventListeners() {
    // This is now handled by individual components
    console.log('Event listeners setup (legacy function called)');
}