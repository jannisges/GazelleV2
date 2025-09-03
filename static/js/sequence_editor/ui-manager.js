// UI management for sequence editor
class UIManager {
    constructor() {
        this.currentSong = null;
        this.currentSequence = { events: [] };
        this.patchedDevices = [];
        this.isExpanded = false;
        
        this.setupEventListeners();
        this.checkForEditParameter();
    }
    
    setupEventListeners() {
        const uploadBtn = document.getElementById('uploadAudioBtn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => this.openFileDialog());
        }
        
        const saveSequenceBtn = document.getElementById('saveSequenceBtn');
        if (saveSequenceBtn) {
            saveSequenceBtn.addEventListener('click', () => this.saveSequence());
        }
        
        const toggleExpandBtn = document.getElementById('toggleExpandBtn');
        if (toggleExpandBtn) {
            toggleExpandBtn.addEventListener('click', () => this.toggleSequenceExpanded());
        }
        
        const addEventBtn = document.getElementById('addEventBtn');
        if (addEventBtn) {
            addEventBtn.addEventListener('click', () => this.addSequenceEvent());
        }
        
        const audioFileInput = document.getElementById('audioFileInput');
        if (audioFileInput) {
            audioFileInput.addEventListener('change', (e) => this.handleFileUpload(e.target));
        }
        
        console.log('UI Manager event listeners setup complete');
    }
    
    checkForEditParameter() {
        const urlParams = new URLSearchParams(window.location.search);
        const editSequenceId = urlParams.get('edit');
        
        if (editSequenceId) {
            this.loadSequence(parseInt(editSequenceId));
        }
    }
    
    loadSequence(sequenceId) {
        fetch(`/api/get-sequence/${sequenceId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const sequence = data.sequence;
                    
                    // Load the song data
                    this.currentSong = sequence.song;
                    this.currentSequence = {
                        id: sequence.id,
                        name: sequence.name,
                        events: sequence.events
                    };
                    
                    // Update UI
                    this.updateSongInfo();
                    
                    // Notify other components
                    if (window.playbackController) {
                        window.playbackController.setCurrentSong(this.currentSong);
                        window.playbackController.setCurrentSequence(this.currentSequence);
                    }
                    
                    // Render waveform and sequence
                    if (this.currentSong.waveform_data) {
                        this.renderWaveform(this.currentSong.waveform_data, this.currentSong.duration);
                    }
                    
                    if (window.sequenceEditor) {
                        window.sequenceEditor.loadSequence(this.currentSequence.events, this.currentSong.duration);
                    }
                    
                    this.updateTimeline();
                    
                    console.log('Sequence loaded for editing:', sequence.name);
                } else {
                    alert('Error loading sequence: ' + data.error);
                }
            })
            .catch(error => {
                console.error('Error loading sequence:', error);
                alert('Error loading sequence: ' + error.message);
            });
    }
    
    setCurrentSong(song) {
        this.currentSong = song;
        this.updateSongInfo();
    }
    
    setCurrentSequence(sequence) {
        this.currentSequence = sequence;
    }
    
    setPatchedDevices(devices) {
        this.patchedDevices = devices;
        this.updateDeviceList();
    }
    
    openFileDialog() {
        const fileInput = document.getElementById('audioFileInput');
        if (fileInput) {
            fileInput.click();
        }
    }
    
    handleFileUpload(input) {
        const file = input.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        
        // Show loading indicator
        const uploadButton = document.getElementById('uploadAudioBtn');
        const originalText = uploadButton.innerHTML;
        uploadButton.innerHTML = '<i class="bi bi-hourglass-split"></i> Processing...';
        uploadButton.disabled = true;
        
        fetch('/api/upload-song', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Upload response:', data);
            if (data.error) {
                alert('Error: ' + data.error);
                return;
            }
            
            this.currentSong = data;
            console.log('Current song set:', this.currentSong);
            this.updateSongInfo();
            
            // Notify other components
            if (window.playbackController) {
                window.playbackController.setCurrentSong(data);
            }
            
            console.log('Calling renderWaveform with:', data.waveform_data);
            this.renderWaveform(data.waveform_data, data.duration);
            this.updateTimeline();
            alert('File uploaded and processed successfully!');
        })
        .catch(error => {
            console.error('Error uploading file:', error);
            alert('Error uploading file: ' + error.message);
        })
        .finally(() => {
            // Restore upload button
            uploadButton.innerHTML = originalText;
            uploadButton.disabled = false;
        });
    }
    
    updateSongInfo() {
        if (!this.currentSong) return;
        
        const songNameElement = document.getElementById('songName');
        const songDurationElement = document.getElementById('songDuration');
        const totalDurationElement = document.getElementById('totalDuration');
        const songInfoElement = document.getElementById('songInfo');
        
        if (songNameElement) {
            songNameElement.textContent = this.currentSong.name;
        }
        if (songDurationElement) {
            songDurationElement.textContent = `Duration: ${this.formatTime(this.currentSong.duration)}`;
        }
        if (totalDurationElement) {
            totalDurationElement.textContent = this.formatTime(this.currentSong.duration);
        }
        if (songInfoElement) {
            songInfoElement.style.display = 'block';
        }
        
        // Update sequence editor duration
        if (window.sequenceEditor) {
            window.sequenceEditor.setDuration(this.currentSong.duration);
        }
    }
    
    renderWaveform(waveformData, duration) {
        if (window.renderWaveform) {
            window.renderWaveform(waveformData, duration);
        }
    }
    
    updateTimeline() {
        if (window.updateTimeline) {
            window.updateTimeline();
        }
    }
    
    toggleSequenceExpanded() {
        this.isExpanded = !this.isExpanded;
        if (window.sequenceEditor) {
            window.sequenceEditor.setExpanded(this.isExpanded);
        }
    }
    
    addSequenceEvent() {
        if (window.eventModal) {
            window.eventModal.showAddDialog(0);
        }
    }
    
    saveSequence() {
        if (!this.currentSong) {
            alert('Please load a song first');
            return;
        }
        
        // If editing existing sequence, use current name as default
        const defaultName = this.currentSequence.name || '';
        const sequenceName = prompt('Enter sequence name:', defaultName);
        if (!sequenceName) return;
        
        const sequenceData = {
            song_id: this.currentSong.id,
            name: sequenceName,
            events: this.currentSequence.events
        };
        
        // Include sequence ID if editing existing sequence
        if (this.currentSequence.id) {
            sequenceData.id = this.currentSequence.id;
        }
        
        fetch('/api/save-sequence', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(sequenceData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert('Error: ' + data.error);
            } else {
                alert('Sequence saved successfully!');
                // Update current sequence ID if it was a new sequence
                if (!this.currentSequence.id && data.sequence_id) {
                    this.currentSequence.id = data.sequence_id;
                    this.currentSequence.name = sequenceName;
                }
            }
        })
        .catch(error => {
            console.error('Error saving sequence:', error);
            alert('Error saving sequence');
        });
    }
    
    loadPatchedDevices() {
        fetch('/api/patched-devices')
            .then(response => response.json())
            .then(data => {
                this.patchedDevices = data;
                this.updateDeviceList();
                
                // Update event modal with devices
                if (window.eventModal) {
                    window.eventModal.setPatchedDevices(data);
                }
            })
            .catch(error => console.error('Error loading patched devices:', error));
    }
    
    updateDeviceList() {
        // Update device list in event modal
        const deviceList = document.getElementById('deviceList');
        if (deviceList) {
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
    }
    
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
    
    getCurrentSong() {
        return this.currentSong;
    }
    
    getCurrentSequence() {
        return this.currentSequence;
    }
    
    getPatchedDevices() {
        return this.patchedDevices;
    }
}