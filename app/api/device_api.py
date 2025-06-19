from flask import Blueprint, request, jsonify
from app.models.models import Device, PatchedDevice, db

device_api = Blueprint('device_api', __name__)

@device_api.route('/api/save-device', methods=['POST'])
def save_device():
    try:
        data = request.get_json()
        name = data.get('name')
        channels = data.get('channels', [])
        device_id = data.get('id')
        
        if not name:
            return jsonify({'error': 'Device name is required'}), 400
        
        if device_id:
            # Update existing device
            device = db.session.get(Device, device_id)
            if not device:
                return jsonify({'error': 'Device not found'}), 404
            device.name = name
            device.set_channels(channels)
        else:
            # Create new device
            device = Device(name=name)
            device.set_channels(channels)
            db.session.add(device)
        
        db.session.commit()
        return jsonify({'success': True, 'device_id': device.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@device_api.route('/api/get-device/<int:device_id>')
def get_device(device_id):
    try:
        device = db.session.get(Device, device_id)
        if not device:
            return jsonify({'error': 'Device not found'}), 404
        
        return jsonify({
            'success': True,
            'device': {
                'id': device.id,
                'name': device.name,
                'channels': device.channels
            }
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@device_api.route('/api/delete-device', methods=['POST'])
def delete_device():
    try:
        data = request.get_json()
        device_id = data.get('device_id')
        
        device = db.session.get(Device, device_id)
        if not device:
            return jsonify({'error': 'Device not found'}), 404
        
        # Remove all patches for this device
        PatchedDevice.query.filter_by(device_id=device_id).delete()
        
        # Delete the device
        db.session.delete(device)
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@device_api.route('/api/patch-device', methods=['POST'])
def patch_device():
    try:
        data = request.get_json()
        device_id = data.get('device_id')
        start_address = data.get('start_address')
        
        device = db.session.get(Device, device_id)
        if not device:
            return jsonify({'error': 'Device not found'}), 404
        
        channels = device.get_channels()
        channel_count = len(channels)
        
        # Check if addresses are available
        for i in range(channel_count):
            address = start_address + i
            if address > 512:
                return jsonify({'error': 'Address range exceeds DMX universe (512 channels)'}), 400
            
            # Simple check for overlapping addresses
            existing_patches = PatchedDevice.query.all()
            for existing in existing_patches:
                existing_channels = existing.device.get_channels()
                existing_channel_count = len(existing_channels)
                existing_end = existing.start_address + existing_channel_count - 1
                
                if existing.start_address <= address <= existing_end:
                    return jsonify({'error': f'Address {address} is already occupied by {existing.device.name}'}), 400
        
        # Create patch
        patch = PatchedDevice(
            device_id=device_id,
            start_address=start_address,
            x_position=50,
            y_position=50
        )
        
        db.session.add(patch)
        db.session.commit()
        
        return jsonify({'success': True, 'patch_id': patch.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@device_api.route('/api/unpatch-device', methods=['POST'])
def unpatch_device():
    try:
        data = request.get_json()
        patch_id = data.get('patch_id')
        
        patch = db.session.get(PatchedDevice, patch_id)
        if not patch:
            return jsonify({'error': 'Patch not found'}), 404
        
        db.session.delete(patch)
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@device_api.route('/api/update-patch-position', methods=['POST'])
def update_patch_position():
    try:
        data = request.get_json()
        patch_id = data.get('patch_id')
        x_position = data.get('x_position')
        y_position = data.get('y_position')
        
        patch = db.session.get(PatchedDevice, patch_id)
        if not patch:
            return jsonify({'error': 'Patch not found'}), 404
        
        patch.x_position = x_position
        patch.y_position = y_position
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@device_api.route('/api/patched-devices')
def get_patched_devices():
    try:
        patches = PatchedDevice.query.all()
        result = []
        
        for patch in patches:
            result.append({
                'id': patch.id,
                'device_id': patch.device_id,
                'start_address': patch.start_address,
                'x_position': patch.x_position,
                'y_position': patch.y_position,
                'device': {
                    'id': patch.device.id,
                    'name': patch.device.name,
                    'channels': patch.device.get_channels()
                }
            })
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@device_api.route('/api/clear-all-patch', methods=['POST'])
def clear_all_patch():
    try:
        PatchedDevice.query.delete()
        db.session.commit()
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@device_api.route('/api/export-patch')
def export_patch():
    try:
        patches = PatchedDevice.query.all()
        export_data = {
            'devices': [],
            'patches': []
        }
        
        # Export devices
        for device in Device.query.all():
            export_data['devices'].append({
                'id': device.id,
                'name': device.name,
                'channels': device.get_channels()
            })
        
        # Export patches
        for patch in patches:
            export_data['patches'].append({
                'device_id': patch.device_id,
                'start_address': patch.start_address,
                'x_position': patch.x_position,
                'y_position': patch.y_position
            })
        
        return jsonify({'success': True, 'data': export_data})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500