import os
import subprocess
from flask import Blueprint, request, jsonify

network_api = Blueprint('network_api', __name__)

@network_api.route('/api/storage-info')
def storage_info():
    try:
        # Get internal storage info
        statvfs = os.statvfs('.')
        total = statvfs.f_frsize * statvfs.f_blocks
        used = total - (statvfs.f_frsize * statvfs.f_bavail)
        
        internal_storage = {
            'total': total,
            'used': used,
            'free': total - used
        }
        
        # Get external storage info
        external_storage = scan_external_storage()
        
        return jsonify({
            'success': True,
            'data': {
                'internal': internal_storage,
                'external': external_storage
            }
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@network_api.route('/api/network-status')
def network_status():
    try:
        # Get actual network status using nmcli or ip commands
        network_info = get_network_status()
        
        return jsonify({
            'success': True,
            'data': network_info
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@network_api.route('/api/wifi-networks')
def wifi_networks():
    try:
        # Scan for actual WiFi networks
        networks = scan_wifi_networks()
        
        return jsonify({'success': True, 'networks': networks})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@network_api.route('/api/connect-wifi', methods=['POST'])
def connect_wifi():
    try:
        data = request.get_json()
        ssid = data.get('ssid')
        password = data.get('password')

        if not ssid:
            return jsonify({'success': False, 'error': 'SSID is required'}), 400

        # Try to connect using nmcli with sudo for proper permissions
        cmd = ['sudo', 'nmcli', 'device', 'wifi', 'connect', ssid]
        if password:
            cmd.extend(['password', password])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if result.returncode == 0:
            return jsonify({
                'success': True,
                'message': f'Connected to {ssid}'
            })
        else:
            # Return detailed error message from nmcli
            error_msg = result.stderr.strip() if result.stderr.strip() else result.stdout.strip()
            return jsonify({
                'success': False,
                'error': f'Failed to connect: {error_msg}'
            })

    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'error': 'Connection timeout - the network took too long to respond'}), 200
    except FileNotFoundError:
        return jsonify({'success': False, 'error': 'nmcli not found - NetworkManager may not be installed'}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Connection error: {str(e)}'}), 200

@network_api.route('/api/disconnect-wifi', methods=['POST'])
def disconnect_wifi():
    try:
        result = subprocess.run(['sudo', 'nmcli', 'connection', 'down', 'id', 'wifi'],
                              capture_output=True, text=True, timeout=10)
        
        return jsonify({
            'success': True,
            'message': 'Disconnected from WiFi'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@network_api.route('/api/configure-hotspot', methods=['POST'])
def configure_hotspot():
    try:
        data = request.get_json()
        ssid = data.get('ssid', 'DMX-Control-Hotspot')
        password = data.get('password', 'dmxcontrol123')
        
        # Create hotspot using nmcli
        result = subprocess.run([
            'sudo', 'nmcli', 'connection', 'add', 'type', 'wifi', 'ifname', 'wlan0',
            'con-name', 'Hotspot', 'autoconnect', 'yes', 'ssid', ssid,
            'wifi.mode', 'ap', 'wifi.band', 'bg', 'ipv4.method', 'shared',
            'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', password
        ], capture_output=True, text=True, timeout=15)
        
        if result.returncode == 0:
            # Activate the hotspot
            activate_result = subprocess.run([
                'sudo', 'nmcli', 'connection', 'up', 'Hotspot'
            ], capture_output=True, text=True, timeout=10)
            
            if activate_result.returncode == 0:
                return jsonify({
                    'success': True,
                    'message': f'Hotspot "{ssid}" configured and activated'
                })
            else:
                return jsonify({
                    'error': f'Hotspot configured but failed to activate: {activate_result.stderr.strip()}'
                }), 500
        else:
            return jsonify({
                'error': f'Failed to configure hotspot: {result.stderr.strip()}'
            }), 500
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@network_api.route('/api/disable-hotspot', methods=['POST'])
def disable_hotspot():
    try:
        result = subprocess.run(['sudo', 'nmcli', 'connection', 'down', 'Hotspot'],
                              capture_output=True, text=True, timeout=10)

        return jsonify({
            'success': True,
            'message': 'Hotspot disabled'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@network_api.route('/api/add-external-storage', methods=['POST'])
def add_external_storage():
    try:
        data = request.get_json()
        path = data.get('path')

        if not path:
            return jsonify({'success': False, 'error': 'Path is required'}), 400

        # Check if the path is a valid block device
        if not path.startswith('/dev/'):
            return jsonify({'success': False, 'error': 'Invalid device path'}), 400

        # Check if device exists
        if not os.path.exists(path):
            return jsonify({'success': False, 'error': 'Device not found'}), 404

        # Create a mount point if needed
        mount_base = '/mnt'
        device_name = os.path.basename(path)
        mount_point = os.path.join(mount_base, device_name)

        # Create mount directory
        os.makedirs(mount_point, exist_ok=True)

        # Try to mount the device
        result = subprocess.run(['sudo', 'mount', path, mount_point],
                              capture_output=True, text=True, timeout=10)

        if result.returncode == 0:
            return jsonify({
                'success': True,
                'message': f'Device mounted at {mount_point}',
                'mount_point': mount_point
            })
        else:
            error_msg = result.stderr.strip() if result.stderr.strip() else result.stdout.strip()
            return jsonify({
                'success': False,
                'error': f'Failed to mount device: {error_msg}'
            })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@network_api.route('/api/remove-external-storage', methods=['POST'])
def remove_external_storage():
    try:
        data = request.get_json()
        path = data.get('path')

        if not path:
            return jsonify({'success': False, 'error': 'Path is required'}), 400

        # Unmount the device
        result = subprocess.run(['sudo', 'umount', path],
                              capture_output=True, text=True, timeout=10)

        if result.returncode == 0:
            return jsonify({
                'success': True,
                'message': 'External storage removed'
            })
        else:
            error_msg = result.stderr.strip() if result.stderr.strip() else result.stdout.strip()
            return jsonify({
                'success': False,
                'error': f'Failed to unmount device: {error_msg}'
            })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Network management helper functions
def get_network_status():
    """Get current network connection status"""
    try:
        # Try nmcli first (NetworkManager)
        result = subprocess.run(['nmcli', 'connection', 'show', '--active'], 
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:  # Skip header
                active_connection = lines[1].split()
                if len(active_connection) >= 3:
                    conn_name = active_connection[0]
                    conn_type = active_connection[2]
                    
                    # Get IP address
                    ip_result = subprocess.run(['ip', 'route', 'get', '1'], 
                                             capture_output=True, text=True, timeout=5)
                    ip_address = None
                    if ip_result.returncode == 0:
                        for part in ip_result.stdout.split():
                            if part.startswith('src'):
                                ip_index = ip_result.stdout.split().index(part)
                                if ip_index + 1 < len(ip_result.stdout.split()):
                                    ip_address = ip_result.stdout.split()[ip_index + 1]
                                    break
                    
                    return {
                        'connected': True,
                        'ssid': conn_name,
                        'ip_address': ip_address or 'Unknown',
                        'mode': 'wifi' if 'wifi' in conn_type.lower() else 'ethernet'
                    }
        
        # Fallback: check if we have any network interface up
        result = subprocess.run(['ip', 'addr', 'show'], 
                              capture_output=True, text=True, timeout=5)
        
        if result.returncode == 0 and 'inet ' in result.stdout:
            return {
                'connected': True,
                'ssid': 'Unknown',
                'ip_address': 'Connected',
                'mode': 'unknown'
            }
        
        return {
            'connected': False,
            'ssid': None,
            'ip_address': None,
            'mode': 'disconnected'
        }
        
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, Exception):
        # Return basic connection check
        try:
            result = subprocess.run(['ping', '-c', '1', '8.8.8.8'], 
                                  capture_output=True, timeout=3)
            connected = result.returncode == 0
            return {
                'connected': connected,
                'ssid': 'Unknown' if connected else None,
                'ip_address': 'Connected' if connected else None,
                'mode': 'unknown' if connected else 'disconnected'
            }
        except:
            return {
                'connected': False,
                'ssid': None,
                'ip_address': None,
                'mode': 'disconnected'
            }

def scan_wifi_networks():
    """Scan for available WiFi networks"""
    networks = []
    
    try:
        # Try nmcli first (NetworkManager) - use newer format with explicit fields
        result = subprocess.run(['nmcli', '-f', 'BSSID,SSID,MODE,CHAN,FREQ,RATE,SIGNAL,BARS,SECURITY', 'device', 'wifi', 'list'], 
                              capture_output=True, text=True, timeout=15)
        
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            current_ssid = get_current_ssid()
            
            for line in lines[1:]:  # Skip header
                # With -f flag, the format is more structured:
                # BSSID    SSID    MODE    CHAN    FREQ    RATE    SIGNAL    BARS    SECURITY
                line = line.strip()
                if not line:
                    continue
                
                # Check if network is connected (starts with *)
                connected = line.startswith('*')
                if connected:
                    line = line[1:].strip()  # Remove the * marker
                
                # Split the line by multiple spaces to handle formatted columns
                # nmcli with -f creates column-formatted output
                import re
                parts = re.split(r'\s{2,}', line)  # Split on 2+ spaces (column separators)
                
                if len(parts) < 7:  # Need at least BSSID SSID MODE CHAN FREQ RATE SIGNAL
                    # Fallback to space split if column split doesn't work
                    parts = line.split()
                    if len(parts) < 7:
                        continue
                
                try:
                    bssid = parts[0].strip()
                    ssid = parts[1].strip()
                    mode = parts[2].strip()
                    chan = parts[3].strip()
                    
                    # Signal should be at index 6 (BSSID, SSID, MODE, CHAN, FREQ, RATE, SIGNAL)
                    if len(parts) > 6:
                        signal_str = parts[6].strip()
                    else:
                        signal_str = "0"
                    
                    if ssid == '--' or not ssid:
                        continue
                    
                    # Parse signal strength
                    signal = 0
                    try:
                        # nmcli typically shows signal in dBm format like "-45"
                        if signal_str.startswith('-') and signal_str[1:].isdigit():
                            # Convert dBm to percentage
                            dbm = int(signal_str)
                            # Formula: quality = 2 * (dBm + 100) for dBm between -100 and 0
                            signal = max(0, min(100, 2 * (dbm + 100)))
                        elif signal_str.endswith('%'):
                            signal = int(signal_str[:-1])
                        elif signal_str.isdigit():
                            # Already a percentage
                            signal = int(signal_str)
                        else:
                            # Try to extract number from string
                            match = re.search(r'-?\d+', signal_str)
                            if match:
                                num = int(match.group())
                                if num < 0:  # Negative means dBm
                                    signal = max(0, min(100, 2 * (num + 100)))
                                else:  # Positive means percentage
                                    signal = min(100, num)
                    except (ValueError, TypeError):
                        signal = 0
                    
                    # Check if encrypted - look for security info
                    security = parts[8] if len(parts) > 8 else ''
                    encrypted = any(sec in security.upper() for sec in ['WPA', 'WEP', 'WPS'])
                    
                except (IndexError, ValueError):
                    signal = 0
                    encrypted = False
                
                networks.append({
                    'ssid': ssid,
                    'signal': signal,
                    'encrypted': encrypted,
                    'connected': connected or ssid == current_ssid
                })
            
            return networks
            
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
        pass
    
    try:
        # Fallback to iwlist (older systems)
        result = subprocess.run(['iwlist', 'scan'], 
                              capture_output=True, text=True, timeout=15)
        
        if result.returncode == 0:
            current_ssid = get_current_ssid()
            
            # Parse iwlist output
            network = {}
            for line in result.stdout.split('\n'):
                line = line.strip()
                
                if 'Cell' in line and 'Address:' in line:
                    if network and 'ssid' in network:
                        networks.append(network)
                    network = {}
                    
                elif 'ESSID:' in line:
                    ssid = line.split('ESSID:')[1].strip('"')
                    if ssid and ssid != '<hidden>':
                        network['ssid'] = ssid
                        network['connected'] = ssid == current_ssid
                        
                elif 'Quality=' in line:
                    try:
                        quality_part = line.split('Quality=')[1].split()[0]
                        if '/' in quality_part:
                            current, maximum = quality_part.split('/')
                            signal = int((int(current) / int(maximum)) * 100)
                            network['signal'] = signal
                    except:
                        network['signal'] = 0
                        
                elif 'Encryption key:' in line:
                    encrypted = 'on' in line.lower()
                    network['encrypted'] = encrypted
            
            # Add last network
            if network and 'ssid' in network:
                networks.append(network)
                
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
        pass
    
    # Remove duplicates and sort by signal strength
    unique_networks = {}
    for network in networks:
        ssid = network.get('ssid')
        if ssid and (ssid not in unique_networks or 
                    network.get('signal', 0) > unique_networks[ssid].get('signal', 0)):
            unique_networks[ssid] = network
    
    return sorted(unique_networks.values(), key=lambda x: x.get('signal', 0), reverse=True)

def get_current_ssid():
    """Get currently connected WiFi SSID"""
    try:
        result = subprocess.run(['nmcli', 'connection', 'show', '--active'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            for line in lines[1:]:
                if 'wifi' in line.lower():
                    return line.split()[0]
    except:
        pass
    
    try:
        result = subprocess.run(['iwgetid', '-r'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass
    
    return None

def scan_external_storage():
    """Scan for all external storage devices (mounted and unmounted)"""
    external_devices = []
    mounted_devices = {}

    try:
        # First, get info about mounted devices
        with open('/proc/mounts', 'r') as f:
            mounts = f.read()

        usb_patterns = ['/media/', '/mnt/', '/run/media/']

        for line in mounts.split('\n'):
            if not line.strip():
                continue

            parts = line.split()
            if len(parts) >= 3:
                device, mount_point, fs_type = parts[:3]

                if any(mount_point.startswith(pattern) for pattern in usb_patterns):
                    try:
                        statvfs = os.statvfs(mount_point)
                        total = statvfs.f_frsize * statvfs.f_blocks
                        used = total - (statvfs.f_frsize * statvfs.f_bavail)

                        mounted_devices[device] = {
                            'device': device,
                            'path': mount_point,
                            'name': os.path.basename(mount_point),
                            'filesystem': fs_type,
                            'total': total,
                            'used': used,
                            'free': total - used,
                            'mounted': True
                        }
                    except OSError:
                        continue
    except Exception:
        pass

    try:
        # Now scan all block devices using lsblk
        result = subprocess.run(['lsblk', '-J', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL'],
                              capture_output=True, text=True, timeout=10)

        if result.returncode == 0:
            import json
            devices_data = json.loads(result.stdout)

            for device in devices_data.get('blockdevices', []):
                # Look for USB devices and their partitions
                if device.get('type') in ['disk', 'part']:
                    device_path = f"/dev/{device['name']}"

                    # Check if it's already in mounted_devices
                    if device_path in mounted_devices:
                        external_devices.append(mounted_devices[device_path])
                    else:
                        # Unmounted device - add it anyway
                        size_str = device.get('size', '0B')
                        # Parse size (e.g., "1.8T", "500G", "16M")
                        total = parse_size_string(size_str)

                        external_devices.append({
                            'device': device_path,
                            'path': device.get('mountpoint') or device_path,
                            'name': device.get('model') or device['name'],
                            'filesystem': device.get('fstype', 'unknown'),
                            'total': total,
                            'used': 0,
                            'free': total,
                            'mounted': bool(device.get('mountpoint'))
                        })

                    # Check for child partitions
                    for child in device.get('children', []):
                        child_path = f"/dev/{child['name']}"

                        if child_path in mounted_devices:
                            external_devices.append(mounted_devices[child_path])
                        else:
                            size_str = child.get('size', '0B')
                            total = parse_size_string(size_str)

                            external_devices.append({
                                'device': child_path,
                                'path': child.get('mountpoint') or child_path,
                                'name': f"{device.get('model', device['name'])} - {child['name']}",
                                'filesystem': child.get('fstype', 'unknown'),
                                'total': total,
                                'used': 0,
                                'free': total,
                                'mounted': bool(child.get('mountpoint'))
                            })
    except Exception as e:
        # Fallback to mounted devices only if lsblk fails
        external_devices = list(mounted_devices.values())

    return external_devices

def parse_size_string(size_str):
    """Parse size strings like '1.8T', '500G', '16M' to bytes"""
    if not size_str or size_str == '0B':
        return 0

    units = {
        'B': 1,
        'K': 1024,
        'M': 1024**2,
        'G': 1024**3,
        'T': 1024**4,
        'P': 1024**5
    }

    try:
        # Extract number and unit
        import re
        match = re.match(r'([\d.]+)([BKMGTP])?', size_str.upper())
        if match:
            number = float(match.group(1))
            unit = match.group(2) or 'B'
            return int(number * units.get(unit, 1))
    except:
        pass

    return 0