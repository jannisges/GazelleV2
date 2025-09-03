import os
import json
from datetime import datetime
from flask import Blueprint, request, jsonify, send_file
from app.models.models import Sequence, Song, Playlist, db

sequence_api = Blueprint('sequence_api', __name__)

@sequence_api.route('/api/save-sequence', methods=['POST'])
def save_sequence():
    try:
        data = request.get_json()
        song_id = data.get('song_id')
        name = data.get('name')
        events = data.get('events', [])
        sequence_id = data.get('id')
        
        if not song_id or not name:
            return jsonify({'error': 'Song ID and name are required'}), 400
        
        if sequence_id:
            # Update existing sequence
            sequence = db.session.get(Sequence, sequence_id)
            if not sequence:
                return jsonify({'error': 'Sequence not found'}), 404
            sequence.name = name
            sequence.set_events(events)
        else:
            # Create new sequence
            sequence = Sequence(song_id=song_id, name=name)
            sequence.set_events(events)
            db.session.add(sequence)
        
        db.session.commit()
        return jsonify({'success': True, 'sequence_id': sequence.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/get-sequence/<int:sequence_id>')
def get_sequence(sequence_id):
    try:
        sequence = db.session.get(Sequence, sequence_id)
        if not sequence:
            return jsonify({'error': 'Sequence not found'}), 404
        
        return jsonify({
            'success': True,
            'sequence': {
                'id': sequence.id,
                'name': sequence.name,
                'song_id': sequence.song_id,
                'events': sequence.get_events(),
                'song': {
                    'id': sequence.song.id,
                    'name': sequence.song.name,
                    'duration': sequence.song.duration,
                    'waveform_data': json.loads(sequence.song.waveform_data) if sequence.song.waveform_data else []
                }
            }
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/delete-sequence', methods=['POST'])
def delete_sequence():
    try:
        data = request.get_json()
        sequence_id = data.get('sequence_id')
        
        sequence = db.session.get(Sequence, sequence_id)
        if not sequence:
            return jsonify({'error': 'Sequence not found'}), 404
        
        # Remove from playlists
        playlists = Playlist.query.all()
        for playlist in playlists:
            sequences = playlist.get_sequences()
            if sequence_id in sequences:
                sequences.remove(sequence_id)
                playlist.set_sequences(sequences)
        
        db.session.delete(sequence)
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/duplicate-sequence', methods=['POST'])
def duplicate_sequence():
    try:
        data = request.get_json()
        sequence_id = data.get('sequence_id')
        new_name = data.get('new_name')
        
        original = db.session.get(Sequence, sequence_id)
        if not original:
            return jsonify({'error': 'Sequence not found'}), 404
        
        duplicate = Sequence(
            song_id=original.song_id,
            name=new_name,
            events=original.events
        )
        
        db.session.add(duplicate)
        db.session.commit()
        
        return jsonify({'success': True, 'sequence_id': duplicate.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/save-playlist', methods=['POST'])
def save_playlist():
    try:
        data = request.get_json()
        name = data.get('name')
        sequences = data.get('sequences', [])
        is_active = data.get('is_active', True)
        random_mode = data.get('random_mode', False)
        playlist_id = data.get('id')
        
        if not name:
            return jsonify({'error': 'Playlist name is required'}), 400
        
        if playlist_id:
            # Update existing playlist
            playlist = db.session.get(Playlist, playlist_id)
            if not playlist:
                return jsonify({'error': 'Playlist not found'}), 404
            playlist.name = name
            playlist.set_sequences(sequences)
            playlist.is_active = is_active
            playlist.random_mode = random_mode
        else:
            # Create new playlist
            playlist = Playlist(name=name, is_active=is_active, random_mode=random_mode)
            playlist.set_sequences(sequences)
            db.session.add(playlist)
        
        db.session.commit()
        return jsonify({'success': True, 'playlist_id': playlist.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/delete-playlist', methods=['POST'])
def delete_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        
        playlist = db.session.get(Playlist, playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        db.session.delete(playlist)
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/toggle-playlist', methods=['POST'])
def toggle_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        is_active = data.get('is_active')
        
        playlist = db.session.get(Playlist, playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        playlist.is_active = is_active
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/toggle-random-mode', methods=['POST'])
def toggle_random_mode():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        random_mode = data.get('random_mode')
        
        playlist = db.session.get(Playlist, playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        playlist.random_mode = random_mode
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/add-to-playlist', methods=['POST'])
def add_to_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        sequence_ids = data.get('sequence_ids', [])
        
        if not playlist_id or not sequence_ids:
            return jsonify({'error': 'Playlist ID and Sequence IDs are required'}), 400
        
        playlist = db.session.get(Playlist, playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        # Validate all sequences exist
        for sequence_id in sequence_ids:
            sequence = db.session.get(Sequence, sequence_id)
            if not sequence:
                return jsonify({'error': f'Sequence {sequence_id} not found'}), 404
        
        sequences = playlist.get_sequences()
        for sequence_id in sequence_ids:
            if sequence_id not in sequences:
                sequences.append(sequence_id)
        
        playlist.set_sequences(sequences)
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/remove-from-playlist', methods=['POST'])
def remove_from_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        sequence_id = data.get('sequence_id')
        
        if not playlist_id or not sequence_id:
            return jsonify({'error': 'Playlist ID and Sequence ID are required'}), 400
        
        playlist = db.session.get(Playlist, playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        sequences = playlist.get_sequences()
        if sequence_id in sequences:
            sequences.remove(sequence_id)
            playlist.set_sequences(sequences)
            db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/import-sequence', methods=['POST'])
def import_sequence():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not file.filename.endswith('.json'):
            return jsonify({'error': 'Only JSON files are supported'}), 400
        
        try:
            sequence_data = json.loads(file.read().decode('utf-8'))
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON format'}), 400
        
        # Validate required fields
        required_fields = ['name', 'song_id', 'events']
        for field in required_fields:
            if field not in sequence_data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Validate song exists
        song = db.session.get(Song, sequence_data['song_id'])
        if not song:
            return jsonify({'error': 'Referenced song not found'}), 404
        
        # Validate events format
        events = sequence_data['events']
        if not isinstance(events, list):
            return jsonify({'error': 'Events must be an array'}), 400
        
        for event in events:
            if not all(key in event for key in ['time', 'channel', 'value']):
                return jsonify({'error': 'Each event must have time, channel, and value'}), 400
        
        # Create new sequence
        sequence = Sequence(
            song_id=sequence_data['song_id'],
            name=sequence_data['name'],
            events=json.dumps(events)
        )
        
        db.session.add(sequence)
        db.session.commit()
        
        return jsonify({'success': True, 'sequence_id': sequence.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@sequence_api.route('/api/export-sequences')
def export_sequences():
    try:
        from flask import current_app
        
        sequence_ids = request.args.get('ids', '').split(',')
        if not sequence_ids or sequence_ids == ['']:
            # Export all sequences if no IDs specified
            sequences = Sequence.query.all()
        else:
            # Export specific sequences
            sequences = Sequence.query.filter(Sequence.id.in_(sequence_ids)).all()
        
        if not sequences:
            return jsonify({'error': 'No sequences found'}), 404
        
        export_data = []
        for sequence in sequences:
            export_data.append({
                'id': sequence.id,
                'name': sequence.name,
                'song_id': sequence.song_id,
                'song_name': sequence.song.name,
                'events': sequence.get_events(),
                'created_at': sequence.created_at.isoformat()
            })
        
        # Create export filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'sequences_export_{timestamp}.json'
        
        # Save to temporary file
        upload_folder = current_app.config.get('UPLOAD_FOLDER', 'uploads')
        export_path = os.path.join(upload_folder, filename)
        os.makedirs(upload_folder, exist_ok=True)
        
        with open(export_path, 'w') as f:
            json.dump(export_data, f, indent=2)
        
        return send_file(export_path, as_attachment=True, download_name=filename)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500