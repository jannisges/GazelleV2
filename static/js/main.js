// Main JavaScript file for DMX Lighting Control

// Global variables
let isDragging = false;
let dragElement = null;
let dragOffset = { x: 0, y: 0 };

// Utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Color utility functions
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    
    return { h: h * 360, s: s * 100, l: l * 100 };
}

// DMX utility functions
function getDMXValue(percentage) {
    return Math.round(percentage * 255 / 100);
}

function getPercentageValue(dmxValue) {
    return Math.round(dmxValue * 100 / 255);
}

// API helper functions
function apiCall(endpoint, method = 'GET', data = null) {
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    if (data) {
        options.body = JSON.stringify(data);
    }
    
    return fetch(endpoint, options)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        });
}

// Drag and drop functionality
function initializeDragAndDrop() {
    // Check if we're on the patch page by looking for DMX grid element
    // If so, skip initialization as patch.js will handle drag and drop
    const dmxGrid = document.getElementById('dmxGrid');
    if (dmxGrid) {
        console.log('DMX Grid detected, skipping main.js drag and drop initialization (patch.js will handle it)');
        return;
    }
    
    // Only add drag and drop listeners if we're NOT on the patch page
    // This prevents duplicate event listeners that cause double patching
    if (!document.querySelector('script[src*="patch.js"]')) {
        document.addEventListener('dragstart', handleDragStart);
        document.addEventListener('dragover', handleDragOver);
        document.addEventListener('drop', handleDrop);
        document.addEventListener('dragend', handleDragEnd);
    }
}

function handleDragStart(e) {
    if (e.target.classList.contains('device-item')) {
        isDragging = true;
        dragElement = e.target;
        e.dataTransfer.setData('text/plain', '');
        e.target.classList.add('dragging');
    }
}

function handleDragOver(e) {
    if (isDragging) {
        e.preventDefault();
        if (e.target.classList.contains('dmx-address')) {
            e.target.classList.add('drag-over');
        }
    }
}

function handleDrop(e) {
    e.preventDefault();
    if (isDragging && dragElement) {
        const target = e.target.closest('.dmx-address');
        if (target) {
            const deviceId = parseInt(dragElement.dataset.deviceId);
            const address = parseInt(target.dataset.address);
            
            console.log(`Dropping device ${deviceId} on address ${address}`);
            
            // Patch device to DMX address
            patchDevice(deviceId, address);
        }
    }
    
    // Clean up drag states
    document.querySelectorAll('.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });
}

function handleDragEnd(e) {
    if (e.target.classList.contains('device-item')) {
        e.target.classList.remove('dragging');
    }
    isDragging = false;
    dragElement = null;
}

// Device patching functions - Updated to work with PatchManager
function patchDevice(deviceId, startAddress) {
    // Use PatchManager if available, otherwise fallback to direct API call
    if (window.patchManager && typeof window.patchManager.patchDevice === 'function') {
        window.patchManager.patchDevice(deviceId, startAddress);
    } else {
        // Fallback to direct API call
        apiCall('/api/patch-device', 'POST', {
            device_id: parseInt(deviceId),
            start_address: startAddress
        })
        .then(response => {
            if (response.success) {
                showNotification('Device patched successfully', 'success');
                // Reload page as fallback
                setTimeout(() => location.reload(), 500);
            } else {
                showNotification('Error patching device: ' + response.error, 'error');
            }
        })
        .catch(error => {
            console.error('Error patching device:', error);
            showNotification('Error patching device', 'error');
        });
    }
}

function unpatchDevice(patchId) {
    // Use PatchManager if available, otherwise fallback to direct API call
    if (window.patchManager && typeof window.patchManager.unpatchDevice === 'function') {
        window.patchManager.unpatchDevice(patchId);
    } else {
        // Fallback implementation
        if (confirm('Are you sure you want to unpatch this device?')) {
            apiCall('/api/unpatch-device', 'POST', { patch_id: patchId })
            .then(response => {
                if (response.success) {
                    showNotification('Device unpatched successfully', 'success');
                    // Reload page as fallback
                    setTimeout(() => location.reload(), 500);
                } else {
                    showNotification('Error unpatching device: ' + response.error, 'error');
                }
            })
            .catch(error => {
                console.error('Error unpatching device:', error);
                showNotification('Error unpatching device', 'error');
            });
        }
    }
}

// Notification system
function showNotification(message, type = 'info', duration = 3000) {
    const alertClass = type === 'error' ? 'alert-danger' : 
                     type === 'success' ? 'alert-success' : 
                     type === 'warning' ? 'alert-warning' : 'alert-info';
    
    const notification = document.createElement('div');
    notification.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-dismiss after duration
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, duration);
}

// Form validation
function validateForm(formElement) {
    const inputs = formElement.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;
    
    inputs.forEach(input => {
        if (!input.value.trim()) {
            input.classList.add('is-invalid');
            isValid = false;
        } else {
            input.classList.remove('is-invalid');
        }
    });
    
    return isValid;
}

// Local storage helpers
function saveToLocalStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving to localStorage:', error);
    }
}

function loadFromLocalStorage(key) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Error loading from localStorage:', error);
        return null;
    }
}

// Time formatting
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

// File size formatting
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Device channel type colors
const channelTypeColors = {
    'dimmer_channel': '#ffc107',
    'dimmer_fine': '#ffc107',
    'red_channel': '#dc3545',
    'green_channel': '#28a745',
    'blue_channel': '#007bff',
    'white_channel': '#f8f9fa',
    'pan': '#17a2b8',
    'pan_fine': '#17a2b8',
    'tilt': '#6f42c1',
    'tilt_fine': '#6f42c1',
    'gobo1': '#fd7e14',
    'gobo2': '#fd7e14',
    'gobo_rotation': '#fd7e14',
    'gobo_rotation_fine': '#fd7e14',
    'color_wheel': '#e83e8c',
    'strobe': '#20c997',
    'prism': '#795548',
    'prisma_rotation': '#795548',
    'frost': '#9e9e9e',
    'zoom': '#607d8b',
    'zoom_fine': '#607d8b',
    'focus': '#3f51b5',
    'focus_fine': '#3f51b5',
    'macro': '#9c27b0',
    'special_functions': '#ff5722',
    'reset': '#f44336',
    'dummy': '#6c757d'
};

function getChannelTypeColor(channelType) {
    return channelTypeColors[channelType] || '#6c757d';
}

// Theme management
function initializeTheme() {
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-bs-theme', savedTheme);
        // Refresh waveform if it exists
        if (window.waveformRenderer) {
            window.waveformRenderer.refreshTheme();
        }
    } else {
        // Check server-side setting
        apiCall('/api/get-dark-mode')
        .then(response => {
            if (response.success) {
                const theme = response.dark_mode ? 'dark' : 'light';
                document.documentElement.setAttribute('data-bs-theme', theme);
                localStorage.setItem('theme', theme);
                // Refresh waveform if it exists
                if (window.waveformRenderer) {
                    window.waveformRenderer.refreshTheme();
                }
            }
        })
        .catch(error => {
            console.error('Error loading theme setting:', error);
            // Default to light mode on error
            document.documentElement.setAttribute('data-bs-theme', 'light');
            localStorage.setItem('theme', 'light');
            // Refresh waveform if it exists
            if (window.waveformRenderer) {
                window.waveformRenderer.refreshTheme();
            }
        });
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    initializeTheme();
    initializeDragAndDrop();
    
    // Initialize tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    // Initialize popovers
    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    popoverTriggerList.map(function (popoverTriggerEl) {
        return new bootstrap.Popover(popoverTriggerEl);
    });
    
    // Setup form validation
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            if (!validateForm(form)) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const saveButton = document.querySelector('[onclick*="save"]');
        if (saveButton) {
            saveButton.click();
        }
    }
    
    // Space to play/pause
    if (e.code === 'Space' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        const playButton = document.querySelector('[onclick*="play"]');
        if (playButton) {
            playButton.click();
        }
    }
    
    // Escape to stop or close modals
    if (e.key === 'Escape') {
        const stopButton = document.querySelector('[onclick*="stop"]');
        if (stopButton) {
            stopButton.click();
        }
    }
});

// Window resize handler
window.addEventListener('resize', debounce(function() {
    // Trigger resize events for canvas elements
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach(canvas => {
        if (canvas.resizeHandler) {
            canvas.resizeHandler();
        }
    });
}, 250));

// Export functions for use in other scripts
window.DMXUtils = {
    apiCall,
    showNotification,
    formatTime,
    formatDuration,
    formatFileSize,
    hexToRgb,
    rgbToHex,
    getDMXValue,
    getPercentageValue,
    getChannelTypeColor,
    saveToLocalStorage,
    loadFromLocalStorage,
    validateForm
};