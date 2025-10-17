#!/usr/bin/env python3
"""
Migration script to add default_values column to Device table.
This script adds support for storing default DMX values for each device channel.
"""

import sqlite3
import sys
import os

# Database path
DB_PATH = 'instance/dmx_control.db'

def migrate():
    """Add default_values column to Device table if it doesn't exist"""

    if not os.path.exists(DB_PATH):
        print(f"Error: Database not found at {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Check if column already exists
        cursor.execute("PRAGMA table_info(device)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'default_values' in columns:
            print("Migration already applied: default_values column exists")
            return

        print("Adding default_values column to device table...")

        # Add the new column
        cursor.execute("""
            ALTER TABLE device
            ADD COLUMN default_values TEXT
        """)

        conn.commit()
        print("Migration completed successfully!")
        print("  - Added 'default_values' column to 'device' table")
        print("\nNote: Existing devices will have NULL default_values (treated as empty array)")

    except sqlite3.Error as e:
        print(f"Error during migration: {e}")
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add default_values to Device table")
    print("=" * 60)
    migrate()
