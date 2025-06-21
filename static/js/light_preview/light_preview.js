// Light preview module for 2D visualization

class LightPreview {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.fixtures = new Map();
        this.selectedFixture = null;
        this.dmxData = new Array(512).fill(0);
        
        this.setupEventListeners();
        this.startUpdateLoop();
    }
    
    setupEventListeners() {
        // Click to select fixtures
        this.container.addEventListener('click', (e) => {
            if (e.target.classList.contains('light-fixture')) {
                this.selectFixture(e.target);
            } else {
                this.deselectFixture();
            }
        });
    }
    
    loadPatchedDevices(patchedDevices) {
        // Clear existing fixtures
        this.container.querySelectorAll('.light-fixture').forEach(f => f.remove());
        this.fixtures.clear();
        
        // Add fixtures for patched devices
        patchedDevices.forEach(patch => {
            this.addFixture(patch);
        });
    }
    
    addFixture(patch) {
        const fixture = document.createElement('div');
        fixture.className = 'light-fixture';
        fixture.dataset.patchId = patch.id;
        fixture.dataset.startAddress = patch.start_address;
        fixture.textContent = patch.start_address;
        fixture.title = patch.device.name;
        
        // Position fixture
        fixture.style.left = (patch.x_position || 50) + '%';
        fixture.style.top = (patch.y_position || 50) + '%';
        
        this.container.appendChild(fixture);
        
        // Store fixture data
        this.fixtures.set(patch.id, {
            element: fixture,
            patch: patch,
            channels: patch.device.channels ? JSON.parse(patch.device.channels) : []
        });
    }
    
    updateFixture(patchId, dmxData) {
        const fixtureData = this.fixtures.get(patchId);
        if (!fixtureData) return;
        
        const fixture = fixtureData.element;
        const patch = fixtureData.patch;
        const channels = fixtureData.channels;
        
        let brightness = 1.0;
        let red = 255, green = 255, blue = 255, white = 0;
        
        // Extract values from DMX data
        channels.forEach((channel, index) => {
            const dmxAddress = patch.start_address + index - 1; // Convert to 0-based
            const value = dmxData[dmxAddress] || 0;
            
            switch (channel.type) {
                case 'dimmer_channel':
                    brightness = value / 255;
                    break;
                case 'red_channel':
                    red = value;
                    break;
                case 'green_channel':
                    green = value;
                    break;
                case 'blue_channel':
                    blue = value;
                    break;
                case 'white_channel':
                    white = value;
                    break;
            }
        });
        
        // Apply white channel to RGB
        if (white > 0) {
            const whiteFactor = white / 255;
            red = Math.min(255, red + white * whiteFactor);
            green = Math.min(255, green + white * whiteFactor);
            blue = Math.min(255, blue + white * whiteFactor);
        }
        
        // Apply brightness
        red = Math.floor(red * brightness);
        green = Math.floor(green * brightness);
        blue = Math.floor(blue * brightness);
        
        // Update fixture appearance
        fixture.style.backgroundColor = `rgb(${red}, ${green}, ${blue})`;
        fixture.style.opacity = Math.max(0.3, brightness);
        
        // Calculate glow intensity
        const glowIntensity = brightness * 20;
        const glowColor = `rgba(${red}, ${green}, ${blue}, 0.8)`;
        fixture.style.boxShadow = `0 0 ${glowIntensity}px ${glowColor}`;
        
        // Update border color
        const borderColor = brightness > 0.5 ? '#000' : '#fff';
        fixture.style.borderColor = borderColor;
    }
    
    updateAllFixtures(dmxData) {
        this.dmxData = dmxData || this.dmxData;
        
        this.fixtures.forEach((fixtureData, patchId) => {
            this.updateFixture(patchId, this.dmxData);
        });
    }
    
    selectFixture(fixtureElement) {
        if (this.selectedFixture) {
            this.selectedFixture.classList.remove('selected');
        }
        
        this.selectedFixture = fixtureElement;
        fixtureElement.classList.add('selected');
        
        // Show fixture info (optional)
        const patchId = parseInt(fixtureElement.dataset.patchId);
        const fixtureData = this.fixtures.get(patchId);
        
        if (fixtureData) {
            this.showFixtureInfo(fixtureData);
        }
    }
    
    deselectFixture() {
        if (this.selectedFixture) {
            this.selectedFixture.classList.remove('selected');
            this.selectedFixture = null;
        }
    }
    
    showFixtureInfo(fixtureData) {
        // Create or update info panel (optional enhancement)
        console.log('Selected fixture:', fixtureData.patch.device.name);
    }
    
    setFixtureColor(patchId, color) {
        const fixtureData = this.fixtures.get(patchId);
        if (!fixtureData) return;
        
        const patch = fixtureData.patch;
        const channels = fixtureData.channels;
        
        // Convert hex color to RGB
        const rgb = this.hexToRgb(color);
        if (!rgb) return;
        
        // Update DMX data for this fixture
        channels.forEach((channel, index) => {
            const dmxAddress = patch.start_address + index - 1;
            
            switch (channel.type) {
                case 'red_channel':
                    this.dmxData[dmxAddress] = rgb.r;
                    break;
                case 'green_channel':
                    this.dmxData[dmxAddress] = rgb.g;
                    break;
                case 'blue_channel':
                    this.dmxData[dmxAddress] = rgb.b;
                    break;
            }
        });
        
        // Update visual
        this.updateFixture(patchId, this.dmxData);
        
        // Send to server
        this.sendDMXUpdate();
    }
    
    setFixtureBrightness(patchId, brightness) {
        const fixtureData = this.fixtures.get(patchId);
        if (!fixtureData) return;
        
        const patch = fixtureData.patch;
        const channels = fixtureData.channels;
        
        // Update DMX data for dimmer channels
        channels.forEach((channel, index) => {
            if (channel.type === 'dimmer_channel') {
                const dmxAddress = patch.start_address + index - 1;
                this.dmxData[dmxAddress] = Math.floor(brightness * 255 / 100);
            }
        });
        
        // Update visual
        this.updateFixture(patchId, this.dmxData);
        
        // Send to server
        this.sendDMXUpdate();
    }
    
    blackoutAll() {
        this.dmxData.fill(0);
        this.updateAllFixtures();
        this.sendDMXUpdate();
    }
    
    setMasterBrightness(brightness) {
        // Apply brightness to all dimmer channels
        this.fixtures.forEach((fixtureData, patchId) => {
            const patch = fixtureData.patch;
            const channels = fixtureData.channels;
            
            channels.forEach((channel, index) => {
                if (channel.type === 'dimmer_channel') {
                    const dmxAddress = patch.start_address + index - 1;
                    this.dmxData[dmxAddress] = Math.floor(brightness * 255 / 100);
                }
            });
        });
        
        this.updateAllFixtures();
        this.sendDMXUpdate();
    }
    
    setMasterColor(color) {
        const rgb = this.hexToRgb(color);
        if (!rgb) return;
        
        // Apply color to all color channels
        this.fixtures.forEach((fixtureData, patchId) => {
            const patch = fixtureData.patch;
            const channels = fixtureData.channels;
            
            channels.forEach((channel, index) => {
                const dmxAddress = patch.start_address + index - 1;
                
                switch (channel.type) {
                    case 'red_channel':
                        this.dmxData[dmxAddress] = rgb.r;
                        break;
                    case 'green_channel':
                        this.dmxData[dmxAddress] = rgb.g;
                        break;
                    case 'blue_channel':
                        this.dmxData[dmxAddress] = rgb.b;
                        break;
                }
            });
        });
        
        this.updateAllFixtures();
        this.sendDMXUpdate();
    }
    
    startUpdateLoop() {
        // Periodically fetch DMX data from server
        setInterval(() => {
            this.fetchDMXData();
        }, 200); // 5 FPS - reduced frequency to improve performance
    }
    
    fetchDMXData() {
        // In a real implementation, this would fetch current DMX values from the server
        // For now, we'll use the local dmxData
        this.updateAllFixtures();
    }
    
    sendDMXUpdate() {
        // Send DMX data to server (placeholder)
        // In a real implementation, this would send the current DMX values to the server
        console.log('Sending DMX update:', this.dmxData);
    }
    
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }
    
    // Animation effects
    animate(effect, duration = 1000) {
        switch (effect) {
            case 'flash':
                this.flashEffect(duration);
                break;
            case 'fade':
                this.fadeEffect(duration);
                break;
            case 'rainbow':
                this.rainbowEffect(duration);
                break;
        }
    }
    
    flashEffect(duration) {
        let isOn = false;
        const interval = 100; // Flash every 100ms
        const steps = duration / interval;
        let step = 0;
        
        const flash = setInterval(() => {
            isOn = !isOn;
            const brightness = isOn ? 255 : 0;
            
            this.fixtures.forEach((fixtureData, patchId) => {
                const patch = fixtureData.patch;
                const channels = fixtureData.channels;
                
                channels.forEach((channel, index) => {
                    if (channel.type === 'dimmer_channel') {
                        const dmxAddress = patch.start_address + index - 1;
                        this.dmxData[dmxAddress] = brightness;
                    }
                });
            });
            
            this.updateAllFixtures();
            
            if (++step >= steps) {
                clearInterval(flash);
                this.blackoutAll();
            }
        }, interval);
    }
    
    fadeEffect(duration) {
        const steps = 50;
        const stepDuration = duration / steps;
        let step = 0;
        
        const fade = setInterval(() => {
            const brightness = Math.sin((step / steps) * Math.PI) * 255;
            
            this.fixtures.forEach((fixtureData, patchId) => {
                const patch = fixtureData.patch;
                const channels = fixtureData.channels;
                
                channels.forEach((channel, index) => {
                    if (channel.type === 'dimmer_channel') {
                        const dmxAddress = patch.start_address + index - 1;
                        this.dmxData[dmxAddress] = Math.floor(brightness);
                    }
                });
            });
            
            this.updateAllFixtures();
            
            if (++step >= steps) {
                clearInterval(fade);
                this.blackoutAll();
            }
        }, stepDuration);
    }
    
    rainbowEffect(duration) {
        const steps = 100;
        const stepDuration = duration / steps;
        let step = 0;
        
        const rainbow = setInterval(() => {
            this.fixtures.forEach((fixtureData, patchId) => {
                const patch = fixtureData.patch;
                const channels = fixtureData.channels;
                
                // Calculate rainbow color
                const hue = (step * 360 / steps + patchId * 60) % 360;
                const rgb = this.hslToRgb(hue, 100, 50);
                
                channels.forEach((channel, index) => {
                    const dmxAddress = patch.start_address + index - 1;
                    
                    switch (channel.type) {
                        case 'red_channel':
                            this.dmxData[dmxAddress] = rgb.r;
                            break;
                        case 'green_channel':
                            this.dmxData[dmxAddress] = rgb.g;
                            break;
                        case 'blue_channel':
                            this.dmxData[dmxAddress] = rgb.b;
                            break;
                        case 'dimmer_channel':
                            this.dmxData[dmxAddress] = 255;
                            break;
                    }
                });
            });
            
            this.updateAllFixtures();
            
            if (++step >= steps) {
                clearInterval(rainbow);
                this.blackoutAll();
            }
        }, stepDuration);
    }
    
    hslToRgb(h, s, l) {
        h /= 360;
        s /= 100;
        l /= 100;
        
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h * 12) % 12;
            return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        };
        
        return {
            r: Math.round(f(0) * 255),
            g: Math.round(f(8) * 255),
            b: Math.round(f(4) * 255)
        };
    }
}

// Initialize light preview
function initializeLightPreview() {
    if (document.getElementById('lightPreview')) {
        window.lightPreview = new LightPreview('lightPreview');
    }
}

// Render light fixtures
function renderLightFixtures() {
    if (window.lightPreview && typeof patchedDevices !== 'undefined') {
        window.lightPreview.loadPatchedDevices(patchedDevices);
    }
}