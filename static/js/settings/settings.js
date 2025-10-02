// Settings page JavaScript functionality
let selectedWiFiSSID = '';

document.addEventListener('DOMContentLoaded', function() {
    loadStorageInfo();
    loadNetworkStatus();
    loadSystemSettings();
    setupNetworkModeToggle();
    setupDarkModeToggle();
    
    // Refresh network status every 10 seconds
    setInterval(loadNetworkStatus, 10000);
});

function setupNetworkModeToggle() {
    document.querySelectorAll('input[name="networkMode"]').forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.value === 'wifi') {
                document.getElementById('wifiSettings').style.display = 'block';
                document.getElementById('hotspotSettings').style.display = 'none';
            } else {
                document.getElementById('wifiSettings').style.display = 'none';
                document.getElementById('hotspotSettings').style.display = 'block';
            }
        });
    });
}

function setupDarkModeToggle() {
    const darkModeCheckbox = document.getElementById('darkMode');
    darkModeCheckbox.addEventListener('change', function() {
        toggleTheme(this.checked);
    });
}

function toggleTheme(isDark) {
    if (isDark) {
        document.documentElement.setAttribute('data-bs-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.setAttribute('data-bs-theme', 'light');
        localStorage.setItem('theme', 'light');
    }
    
    // Refresh waveform display if it exists
    if (window.waveformRenderer) {
        window.waveformRenderer.refreshTheme();
    }
}

function loadStorageInfo() {
    DMXUtils.apiCall('/api/storage-info')
    .then(response => {
        if (response.success) {
            const data = response.data;
            
            // Update internal storage
            const usedPercent = (data.internal.used / data.internal.total) * 100;
            document.getElementById('internalStorageBar').style.width = usedPercent + '%';
            document.getElementById('internalStorageText').textContent = 
                `${DMXUtils.formatFileSize(data.internal.used)} / ${DMXUtils.formatFileSize(data.internal.total)} (${usedPercent.toFixed(1)}% used)`;
            
            // Update external storage
            const externalList = document.getElementById('externalStorageList');
            externalList.innerHTML = '';
            
            if (data.external && data.external.length > 0) {
                data.external.forEach(storage => {
                    const storageDiv = document.createElement('div');
                    storageDiv.className = 'storage-info';
                    storageDiv.innerHTML = `
                        <div class="storage-icon">
                            <i class="bi bi-usb-drive"></i>
                        </div>
                        <div class="storage-details">
                            <h6>${storage.name}</h6>
                            <div class="progress-bar-container">
                                <div class="progress">
                                    <div class="progress-bar" style="width: ${(storage.used / storage.total) * 100}%"></div>
                                </div>
                            </div>
                            <small>${DMXUtils.formatFileSize(storage.used)} / ${DMXUtils.formatFileSize(storage.total)}</small>
                        </div>
                        <button class="btn btn-sm btn-outline-danger" onclick="removeExternalStorage('${storage.path}')">
                            <i class="bi bi-x"></i>
                        </button>
                    `;
                    externalList.appendChild(storageDiv);
                });
            } else {
                externalList.innerHTML = '<p class="text-muted">No external storage devices connected</p>';
            }
        }
    })
    .catch(error => {
        console.error('Error loading storage info:', error);
    });
}

function loadNetworkStatus() {
    DMXUtils.apiCall('/api/network-status')
    .then(response => {
        if (response.success) {
            const data = response.data;
            const statusBadge = document.getElementById('networkStatus');
            const detailsText = document.getElementById('networkDetails');
            
            if (data.connected) {
                statusBadge.className = 'badge bg-success';
                statusBadge.textContent = 'Connected';
                detailsText.textContent = `Connected to ${data.ssid} (${data.ip_address})`;
            } else {
                statusBadge.className = 'badge bg-danger';
                statusBadge.textContent = 'Disconnected';
                detailsText.textContent = 'Not connected to any network';
            }
            
            // Load WiFi networks if in WiFi mode
            if (document.getElementById('wifiMode').checked) {
                loadWiFiNetworks();
            }
        }
    })
    .catch(error => {
        console.error('Error loading network status:', error);
        document.getElementById('networkStatus').textContent = 'Error';
    });
}

function loadWiFiNetworks() {
    DMXUtils.apiCall('/api/wifi-networks')
    .then(response => {
        if (response.success) {
            const networksDiv = document.getElementById('wifiNetworks');
            networksDiv.innerHTML = '';
            
            // Sort networks by signal strength (backend already sorts, but ensure client-side sorting)
            const sortedNetworks = response.networks.sort((a, b) => (b.signal || 0) - (a.signal || 0));
            
            sortedNetworks.forEach(network => {
                const networkDiv = document.createElement('div');
                networkDiv.className = `wifi-network ${network.connected ? 'connected' : ''}`;
                networkDiv.onclick = () => selectWiFiNetwork(network.ssid, network.encrypted);
                
                const signalStrength = Math.floor(network.signal / 25); // Convert to 0-4 scale
                const signalIcon = ['bi-wifi-off', 'bi-wifi-1', 'bi-wifi-2', 'bi-wifi'][signalStrength] || 'bi-wifi';
                
                // Determine signal strength color
                let signalColor = 'text-danger'; // Weak signal (0-25%)
                if (network.signal >= 75) {
                    signalColor = 'text-success'; // Strong signal
                } else if (network.signal >= 50) {
                    signalColor = 'text-warning'; // Medium signal
                }
                
                networkDiv.innerHTML = `
                    <div class="wifi-icon">
                        <i class="bi ${network.encrypted ? 'bi-lock' : 'bi-unlock'}"></i>
                    </div>
                    <div class="wifi-info">
                        <h6>${network.ssid}</h6>
                        <small>${network.encrypted ? 'Secured' : 'Open'} ${network.connected ? '(Connected)' : ''}</small>
                    </div>
                    <div class="wifi-signal">
                        <div class="d-flex align-items-center">
                            <i class="bi ${signalIcon} ${signalColor} me-1"></i>
                            <small class="${signalColor}">${network.signal}%</small>
                        </div>
                    </div>
                `;
                
                networksDiv.appendChild(networkDiv);
            });
            
            if (response.networks.length === 0) {
                networksDiv.innerHTML = '<p class="text-muted">No WiFi networks found</p>';
            }
        }
    })
    .catch(error => {
        console.error('Error loading WiFi networks:', error);
    });
}

function selectWiFiNetwork(ssid, encrypted) {
    selectedWiFiSSID = ssid;
    
    if (encrypted) {
        document.getElementById('selectedSSID').textContent = ssid;
        const modal = new bootstrap.Modal(document.getElementById('wifiPasswordModal'));
        modal.show();
    } else {
        connectToWiFi('');
    }
}

function connectToWiFi(password = null) {
    if (password === null) {
        password = document.getElementById('wifiPasswordInput').value;
    }
    
    DMXUtils.apiCall('/api/connect-wifi', 'POST', {
        ssid: selectedWiFiSSID,
        password: password
    })
    .then(response => {
        if (response.success) {
            DMXUtils.showNotification('Connecting to WiFi...', 'info');
            bootstrap.Modal.getInstance(document.getElementById('wifiPasswordModal'))?.hide();
            
            // Check connection status after a delay
            setTimeout(loadNetworkStatus, 5000);
        } else {
            DMXUtils.showNotification('Failed to connect: ' + response.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error connecting to WiFi:', error);
        DMXUtils.showNotification('Error connecting to WiFi', 'error');
    });
}

function scanWiFi() {
    DMXUtils.showNotification('Scanning for WiFi networks...', 'info');
    loadWiFiNetworks();
}

function addCustomWiFi() {
    const modal = new bootstrap.Modal(document.getElementById('customWifiModal'));
    modal.show();
}

function addCustomNetwork() {
    const ssid = document.getElementById('customSSID').value;
    const password = document.getElementById('customPassword').value;
    const security = document.getElementById('customSecurity').value;
    
    if (!ssid) {
        DMXUtils.showNotification('Please enter a network name', 'error');
        return;
    }
    
    selectedWiFiSSID = ssid;
    connectToWiFi(password);
    
    bootstrap.Modal.getInstance(document.getElementById('customWifiModal')).hide();
}

function saveNetworkSettings() {
    const mode = document.querySelector('input[name="networkMode"]:checked').value;
    
    if (mode === 'hotspot') {
        const ssid = document.getElementById('hotspotSSID').value;
        const password = document.getElementById('hotspotPassword').value;
        const channel = document.getElementById('hotspotChannel').value;
        
        DMXUtils.apiCall('/api/configure-hotspot', 'POST', {
            ssid: ssid,
            password: password,
            channel: parseInt(channel)
        })
        .then(response => {
            if (response.success) {
                DMXUtils.showNotification('Hotspot configuration saved', 'success');
                setTimeout(loadNetworkStatus, 3000);
            } else {
                DMXUtils.showNotification('Error configuring hotspot: ' + response.error, 'error');
            }
        })
        .catch(error => {
            console.error('Error configuring hotspot:', error);
            DMXUtils.showNotification('Error configuring hotspot', 'error');
        });
    }
}

function restartNetwork() {
    if (confirm('This will restart the network connection. Continue?')) {
        DMXUtils.apiCall('/api/restart-network', 'POST')
        .then(response => {
            DMXUtils.showNotification('Network restarting...', 'info');
            setTimeout(loadNetworkStatus, 10000);
        })
        .catch(error => {
            console.error('Error restarting network:', error);
            DMXUtils.showNotification('Error restarting network', 'error');
        });
    }
}

function togglePasswordVisibility() {
    const passwordInput = document.getElementById('webPassword');
    const toggleIcon = document.getElementById('passwordToggleIcon');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.className = 'bi bi-eye-slash';
    } else {
        passwordInput.type = 'password';
        toggleIcon.className = 'bi bi-eye';
    }
}

function saveSecuritySettings() {
    const password = document.getElementById('webPassword').value;
    const enableHttps = document.getElementById('enableHttps').checked;
    
    DMXUtils.apiCall('/api/save-security-settings', 'POST', {
        web_password: password,
        enable_https: enableHttps
    })
    .then(response => {
        if (response.success) {
            DMXUtils.showNotification('Security settings saved', 'success');
        } else {
            DMXUtils.showNotification('Error saving security settings: ' + response.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error saving security settings:', error);
        DMXUtils.showNotification('Error saving security settings', 'error');
    });
}

function loadSystemSettings() {
    DMXUtils.apiCall('/api/system-settings')
    .then(response => {
        if (response.success) {
            const settings = response.settings;
            document.getElementById('systemName').value = settings.system_name || 'DMX Control System';
            document.getElementById('timezone').value = settings.timezone || 'UTC';
            document.getElementById('autoStart').checked = settings.auto_start !== false;
            document.getElementById('enableLogging').checked = settings.enable_logging !== false;
            document.getElementById('darkMode').checked = settings.dark_mode === true;
        }
    })
    .catch(error => {
        console.error('Error loading system settings:', error);
    });
}

function saveSystemSettings() {
    const settings = {
        system_name: document.getElementById('systemName').value,
        timezone: document.getElementById('timezone').value,
        auto_start: document.getElementById('autoStart').checked,
        enable_logging: document.getElementById('enableLogging').checked,
        dark_mode: document.getElementById('darkMode').checked
    };
    
    DMXUtils.apiCall('/api/save-system-settings', 'POST', settings)
    .then(response => {
        if (response.success) {
            DMXUtils.showNotification('System settings saved', 'success');
        } else {
            DMXUtils.showNotification('Error saving system settings: ' + response.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error saving system settings:', error);
        DMXUtils.showNotification('Error saving system settings', 'error');
    });
}

function scanExternalStorage() {
    DMXUtils.showNotification('Scanning for external storage...', 'info');
    loadStorageInfo();
}

function addExternalStorage() {
    const path = prompt('Enter the path to the external storage device:');
    if (!path) return;
    
    DMXUtils.apiCall('/api/add-external-storage', 'POST', { path: path })
    .then(response => {
        if (response.success) {
            DMXUtils.showNotification('External storage added', 'success');
            loadStorageInfo();
        } else {
            DMXUtils.showNotification('Error adding external storage: ' + response.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error adding external storage:', error);
        DMXUtils.showNotification('Error adding external storage', 'error');
    });
}

function removeExternalStorage(path) {
    if (confirm('Remove this external storage device from the system?')) {
        DMXUtils.apiCall('/api/remove-external-storage', 'POST', { path: path })
        .then(response => {
            if (response.success) {
                DMXUtils.showNotification('External storage removed', 'success');
                loadStorageInfo();
            } else {
                DMXUtils.showNotification('Error removing external storage: ' + response.error, 'error');
            }
        })
        .catch(error => {
            console.error('Error removing external storage:', error);
            DMXUtils.showNotification('Error removing external storage', 'error');
        });
    }
}

function exportAllSettings() {
    DMXUtils.apiCall('/api/export-all-settings')
    .then(response => {
        if (response.success) {
            const blob = new Blob([JSON.stringify(response.data, null, 2)], 
                { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'dmx_control_settings.json';
            a.click();
            URL.revokeObjectURL(url);
            DMXUtils.showNotification('Settings exported successfully', 'success');
        } else {
            DMXUtils.showNotification('Error exporting settings: ' + response.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error exporting settings:', error);
        DMXUtils.showNotification('Error exporting settings', 'error');
    });
}

function importSettings() {
    const modal = new bootstrap.Modal(document.getElementById('importSettingsModal'));
    modal.show();
}

function performSettingsImport() {
    const fileInput = document.getElementById('settingsFile');
    const file = fileInput.files[0];
    
    if (!file) {
        DMXUtils.showNotification('Please select a file to import', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            DMXUtils.apiCall('/api/import-settings', 'POST', data)
            .then(response => {
                if (response.success) {
                    DMXUtils.showNotification('Settings imported successfully. System will restart.', 'success');
                    bootstrap.Modal.getInstance(document.getElementById('importSettingsModal')).hide();
                    setTimeout(() => location.reload(), 3000);
                } else {
                    DMXUtils.showNotification('Error importing settings: ' + response.error, 'error');
                }
            })
            .catch(error => {
                console.error('Error importing settings:', error);
                DMXUtils.showNotification('Error importing settings', 'error');
            });
        } catch (error) {
            DMXUtils.showNotification('Invalid JSON file', 'error');
        }
    };
    
    reader.readAsText(file);
}

function restartSystem() {
    if (confirm('This will restart the entire system. All current sessions will be lost. Continue?')) {
        DMXUtils.apiCall('/api/restart-system', 'POST')
        .then(response => {
            DMXUtils.showNotification('System restarting...', 'info');
        })
        .catch(error => {
            console.error('Error restarting system:', error);
            DMXUtils.showNotification('Error restarting system', 'error');
        });
    }
}

function factoryReset() {
    const confirmation = prompt('This will reset ALL settings and delete ALL data. Type "FACTORY RESET" to confirm:');
    
    if (confirmation === 'FACTORY RESET') {
        DMXUtils.apiCall('/api/factory-reset', 'POST')
        .then(response => {
            if (response.success) {
                DMXUtils.showNotification('Factory reset initiated. System will restart.', 'warning');
                setTimeout(() => location.reload(), 5000);
            } else {
                DMXUtils.showNotification('Error performing factory reset: ' + response.error, 'error');
            }
        })
        .catch(error => {
            console.error('Error performing factory reset:', error);
            DMXUtils.showNotification('Error performing factory reset', 'error');
        });
    }
}