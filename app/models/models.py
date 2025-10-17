from flask_sqlalchemy import SQLAlchemy
import json
from datetime import datetime

db = SQLAlchemy()

class Device(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    channels = db.Column(db.Text)  # JSON string
    shape = db.Column(db.String(20), default='circle')  # circle, square
    color = db.Column(db.String(7), default='#ffffff')  # hex color for outline
    default_values = db.Column(db.Text)  # JSON string - default DMX values for each channel
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def get_channels(self):
        return json.loads(self.channels) if self.channels else []

    def set_channels(self, channels):
        self.channels = json.dumps(channels)

    def get_default_values(self):
        return json.loads(self.default_values) if self.default_values else []

    def set_default_values(self, values):
        self.default_values = json.dumps(values)

class PatchedDevice(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    device_id = db.Column(db.Integer, db.ForeignKey('device.id'), nullable=False)
    start_address = db.Column(db.Integer, nullable=False)
    x_position = db.Column(db.Float, default=0)
    y_position = db.Column(db.Float, default=0)
    device = db.relationship('Device', backref='patches')

class Song(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    filename = db.Column(db.String(200), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    duration = db.Column(db.Float)
    waveform_data = db.Column(db.Text)  # JSON string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Sequence(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    song_id = db.Column(db.Integer, db.ForeignKey('song.id'), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    events = db.Column(db.Text)  # JSON string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    song = db.relationship('Song', backref='sequences')
    
    def get_events(self):
        return json.loads(self.events) if self.events else []
    
    def set_events(self, events):
        self.events = json.dumps(events)

class Playlist(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    sequences = db.Column(db.Text)  # JSON array of sequence IDs
    is_active = db.Column(db.Boolean, default=True)
    random_mode = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def get_sequences(self):
        return json.loads(self.sequences) if self.sequences else []
    
    def set_sequences(self, sequences):
        self.sequences = json.dumps(sequences)

class Settings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text)