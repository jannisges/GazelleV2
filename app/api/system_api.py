import os
import json
import subprocess
import sys
import time
import threading
import shutil
from datetime import datetime
from flask import Blueprint, request, jsonify, send_file
from app.models.models import Device, PatchedDevice, Playlist, db

system_api = Blueprint('system_api', __name__)

@system_api.route('/api/get-dark-mode')
def get_dark_mode():
    try:
        config_dir = os.path.expanduser('~/.dmx_control')
        config_file = os.path.join(config_dir, 'system.json')
        
        if os.path.exists(config_file):
            with open(config_file, 'r') as f:
                settings = json.load(f)
                return jsonify({
                    'success': True,
                    'dark_mode': settings.get('dark_mode', False)
                })
        else:
            return jsonify({
                'success': True,
                'dark_mode': False
            })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@system_api.route('/api/save-security-settings', methods=['POST'])
def save_security_settings():
    try:
        data = request.get_json()
        
        # Store security settings in a config file
        config_dir = os.path.expanduser('~/.dmx_control')
        os.makedirs(config_dir, exist_ok=True)
        config_file = os.path.join(config_dir, 'security.json')
        
        settings = {
            'authentication_enabled': data.get('authentication_enabled', False),
            'password_hash': data.get('password_hash', ''),
            'session_timeout': data.get('session_timeout', 3600),
            'updated_at': datetime.now().isoformat()
        }
        
        with open(config_file, 'w') as f:
            json.dump(settings, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'Security settings saved'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@system_api.route('/api/system-settings')
def system_settings():
    try:
        config_dir = os.path.expanduser('~/.dmx_control')
        config_file = os.path.join(config_dir, 'system.json')
        
        default_settings = {
            'device_name': 'DMX Control System',
            'auto_start': True,
            'dmx_refresh_rate': 25,
            'audio_buffer_size': 1024,
            'max_sequences': 100,
            'backup_enabled': True,
            'debug_mode': False,
            'dark_mode': False,
            'button_lock_duration': 0,  # 0 = disabled, otherwise lock duration in seconds
            'button_lock_trigger': 'after_press'  # 'after_press' or 'after_sequence'
        }
        
        if os.path.exists(config_file):
            with open(config_file, 'r') as f:
                settings = json.load(f)
                # Merge with defaults for missing keys
                for key, value in default_settings.items():
                    if key not in settings:
                        settings[key] = value
        else:
            settings = default_settings
        
        return jsonify({
            'success': True,
            'settings': settings
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@system_api.route('/api/save-system-settings', methods=['POST'])
def save_system_settings():
    try:
        data = request.get_json()
        
        config_dir = os.path.expanduser('~/.dmx_control')
        os.makedirs(config_dir, exist_ok=True)
        config_file = os.path.join(config_dir, 'system.json')
        
        settings = {
            'device_name': data.get('device_name', 'DMX Control System'),
            'auto_start': data.get('auto_start', True),
            'dmx_refresh_rate': data.get('dmx_refresh_rate', 25),
            'audio_buffer_size': data.get('audio_buffer_size', 1024),
            'max_sequences': data.get('max_sequences', 100),
            'backup_enabled': data.get('backup_enabled', True),
            'debug_mode': data.get('debug_mode', False),
            'dark_mode': data.get('dark_mode', False),
            'button_lock_duration': data.get('button_lock_duration', 0),
            'button_lock_trigger': data.get('button_lock_trigger', 'after_press'),
            'updated_at': datetime.now().isoformat()
        }
        
        with open(config_file, 'w') as f:
            json.dump(settings, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'System settings saved'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@system_api.route('/api/export-all-settings')
def export_all_settings():
    try:
        from flask import current_app
        
        config_dir = os.path.expanduser('~/.dmx_control')
        
        # Collect all settings
        all_settings = {
            'exported_at': datetime.now().isoformat(),
            'version': '1.0'
        }
        
        # Load system settings
        system_file = os.path.join(config_dir, 'system.json')
        if os.path.exists(system_file):
            with open(system_file, 'r') as f:
                all_settings['system'] = json.load(f)
        
        # Load security settings (excluding sensitive data)
        security_file = os.path.join(config_dir, 'security.json')
        if os.path.exists(security_file):
            with open(security_file, 'r') as f:
                security_settings = json.load(f)
                # Remove sensitive data
                security_settings.pop('password_hash', None)
                all_settings['security'] = security_settings
        
        # Export database data
        devices = [{'id': d.id, 'name': d.name, 'channels': d.get_channels()} 
                  for d in Device.query.all()]
        all_settings['devices'] = devices
        
        patched_devices = [{'id': p.id, 'device_id': p.device_id, 'start_address': p.start_address,
                           'x_position': p.x_position, 'y_position': p.y_position} 
                          for p in PatchedDevice.query.all()]
        all_settings['patched_devices'] = patched_devices
        
        playlists = [{'id': p.id, 'name': p.name, 'sequences': p.get_sequences()}
                    for p in Playlist.query.all()]
        all_settings['playlists'] = playlists
        
        # Create export file
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'dmx_settings_export_{timestamp}.json'
        upload_folder = current_app.config.get('UPLOAD_FOLDER', 'uploads')
        export_path = os.path.join(upload_folder, filename)
        os.makedirs(upload_folder, exist_ok=True)
        
        with open(export_path, 'w') as f:
            json.dump(all_settings, f, indent=2)
        
        return send_file(export_path, as_attachment=True, download_name=filename)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@system_api.route('/api/import-settings', methods=['POST'])
def import_settings():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read and parse the JSON file
        try:
            settings_data = json.load(file)
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON file'}), 400
        
        # Validate the file format
        if 'version' not in settings_data:
            return jsonify({'error': 'Invalid settings file format'}), 400
        
        config_dir = os.path.expanduser('~/.dmx_control')
        os.makedirs(config_dir, exist_ok=True)
        
        # Import system settings
        if 'system' in settings_data:
            system_file = os.path.join(config_dir, 'system.json')
            with open(system_file, 'w') as f:
                json.dump(settings_data['system'], f, indent=2)
        
        # Import security settings (user will need to reconfigure passwords)
        if 'security' in settings_data:
            security_file = os.path.join(config_dir, 'security.json')
            with open(security_file, 'w') as f:
                json.dump(settings_data['security'], f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'Settings imported successfully. Please restart the system to apply changes.'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@system_api.route('/api/restart-system', methods=['POST'])
def restart_system():
    try:
        # First try systemctl restart for the service
        try:
            subprocess.run(['sudo', 'systemctl', 'restart', 'dmx-control.service'], 
                          capture_output=True, timeout=5)
            return jsonify({
                'success': True,
                'message': 'System service restarted'
            })
        except:
            pass
        
        # Fallback: restart the Python application
        import signal
        
        def restart_app():
            time.sleep(1)  # Give time for response to be sent
            os.execv(sys.executable, ['python'] + sys.argv)
        
        threading.Thread(target=restart_app).start()
        
        return jsonify({
            'success': True,
            'message': 'Application restarting...'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@system_api.route('/api/factory-reset', methods=['POST'])
def factory_reset():
    try:
        from flask import current_app
        
        data = request.get_json()
        confirm = data.get('confirm', False)
        
        if not confirm:
            return jsonify({'error': 'Factory reset requires confirmation'}), 400
        
        # Create backup before reset
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_dir = os.path.join(os.path.expanduser('~'), 'dmx_control_backups')
        os.makedirs(backup_dir, exist_ok=True)
        
        # Backup database
        db_path = 'dmx_control.db'  # Update with actual database path
        if os.path.exists(db_path):
            backup_db = os.path.join(backup_dir, f'pre_reset_db_{timestamp}.db')
            shutil.copy2(db_path, backup_db)
        
        # Clear database
        with current_app.app_context():
            db.drop_all()
            db.create_all()
        
        # Clear config files
        config_dir = os.path.expanduser('~/.dmx_control')
        if os.path.exists(config_dir):
            backup_config = os.path.join(backup_dir, f'pre_reset_config_{timestamp}')
            shutil.copytree(config_dir, backup_config)
            shutil.rmtree(config_dir)
        
        # Clear uploads (but keep a backup)
        upload_dir = current_app.config.get('UPLOAD_FOLDER', 'uploads')
        if os.path.exists(upload_dir):
            backup_uploads = os.path.join(backup_dir, f'pre_reset_uploads_{timestamp}')
            shutil.copytree(upload_dir, backup_uploads)
            shutil.rmtree(upload_dir)
            os.makedirs(upload_dir, exist_ok=True)
        
        return jsonify({
            'success': True,
            'message': f'Factory reset completed. Backup saved to {backup_dir}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500