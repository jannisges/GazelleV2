from flask import Blueprint, request, jsonify
from app.models.models import Device, PatchedDevice, db

device_api = Blueprint('device_api', __name__)

@device_api.route('/api/save-device', methods=['POST'])
def save_device():
    try:
        data = request.get_json()
        name = data.get('name')
        channels = data.get('channels', [])
        shape = data.get('shape', 'circle')
        color = data.get('color', '#ffffff')
        default_values = data.get('default_values', [])
        device_id = data.get('id')

        if not name:
            return jsonify({'error': 'Device name is required'}), 400

        if device_id:
            # Update existing device
            device = db.session.get(Device, device_id)
            if not device:
                return jsonify({'error': 'Device not found'}), 404
            device.name = name
            device.shape = shape
            device.color = color
            device.set_channels(channels)
            device.set_default_values(default_values)
        else:
            # Create new device
            device = Device(name=name, shape=shape, color=color)
            device.set_channels(channels)
            device.set_default_values(default_values)
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
                'channels': device.channels,
                'shape': device.shape,
                'color': device.color,
                'default_values': device.default_values
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
        if start_address < 1 or start_address + channel_count - 1 > 512:
            return jsonify({'error': 'Address range exceeds DMX universe (1-512 channels)'}), 400
        
        # Check if this device is already patched at this address
        existing_patch_same_device = PatchedDevice.query.filter_by(
            device_id=device_id, 
            start_address=start_address
        ).first()
        if existing_patch_same_device:
            return jsonify({'error': f'Device "{device.name}" is already patched at address {start_address}'}), 400
        
        # Check for overlapping addresses with existing patches
        existing_patches = PatchedDevice.query.all()
        for existing in existing_patches:
            existing_channels = existing.device.get_channels()
            existing_channel_count = len(existing_channels) if existing_channels else 1
            existing_start = existing.start_address
            existing_end = existing_start + existing_channel_count - 1
            
            # Check if new device range overlaps with existing device range
            new_start = start_address
            new_end = start_address + channel_count - 1
            
            # Ranges overlap if: new_start <= existing_end AND new_end >= existing_start
            if new_start <= existing_end and new_end >= existing_start:
                return jsonify({'error': f'Address range {new_start}-{new_end} conflicts with {existing.device.name} at {existing_start}-{existing_end}'}), 400
        
        # Create patch
        patch = PatchedDevice(
            device_id=device_id,
            start_address=start_address,
            x_position=0,
            y_position=0
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

@device_api.route('/api/update-patch-address', methods=['POST'])
def update_patch_address():
    try:
        data = request.get_json()
        patch_id = data.get('patch_id')
        start_address = data.get('start_address')
        
        if not patch_id or not start_address:
            return jsonify({'error': 'patch_id and start_address are required'}), 400
        
        patch = db.session.get(PatchedDevice, patch_id)
        if not patch:
            return jsonify({'error': 'Patch not found'}), 404
        
        device = patch.device
        channels = device.get_channels()
        channel_count = len(channels)
        
        # Check if new addresses are available
        if start_address < 1 or start_address + channel_count - 1 > 512:
            return jsonify({'error': 'Address range exceeds DMX universe (1-512 channels)'}), 400
        
        # Check for overlapping addresses with existing patches (excluding current patch)
        existing_patches = PatchedDevice.query.filter(PatchedDevice.id != patch_id).all()
        for existing in existing_patches:
            existing_channels = existing.device.get_channels()
            existing_channel_count = len(existing_channels) if existing_channels else 1
            existing_start = existing.start_address
            existing_end = existing_start + existing_channel_count - 1
            
            # Check if new device range overlaps with existing device range
            new_start = start_address
            new_end = start_address + channel_count - 1
            
            # Ranges overlap if: new_start <= existing_end AND new_end >= existing_start
            if new_start <= existing_end and new_end >= existing_start:
                return jsonify({'error': f'Address range {new_start}-{new_end} conflicts with {existing.device.name} at {existing_start}-{existing_end}'}), 400
        
        # Update the patch address
        patch.start_address = start_address
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
                    'channels': patch.device.get_channels(),
                    'shape': patch.device.shape or 'circle',
                    'color': patch.device.color or '#ffffff',
                    'default_values': patch.device.get_default_values()
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
                'channels': device.get_channels(),
                'shape': device.shape or 'circle',
                'color': device.color or '#ffffff'
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