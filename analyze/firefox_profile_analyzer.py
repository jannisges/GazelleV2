#!/usr/bin/env python3
"""
Firefox Performance Profile Analyzer for Sequence Editor
=======================================================

This script analyzes Firefox performance profiles to identify bottlenecks
in the DMX sequence editor application. It processes the JSON profile data
and provides detailed performance insights.

Usage:
    python firefox_profile_analyzer.py <profile.json.gz>
    python firefox_profile_analyzer.py <profile.json>

Example:
    python firefox_profile_analyzer.py "Firefox 2025-06-21 15.43 profile.json.gz"
"""

import json
import gzip
import sys
import os
from datetime import datetime
from collections import defaultdict, Counter


class FirefoxProfileAnalyzer:
    def __init__(self, profile_path):
        self.profile_path = profile_path
        self.profile_data = None
        self.analysis_results = {}
        
    def load_profile(self):
        """Load and parse the Firefox profile data."""
        try:
            if self.profile_path.endswith('.gz'):
                with gzip.open(self.profile_path, 'rt', encoding='utf-8') as f:
                    self.profile_data = json.load(f)
            else:
                with open(self.profile_path, 'r', encoding='utf-8') as f:
                    self.profile_data = json.load(f)
            
            print(f"✓ Successfully loaded profile: {self.profile_path}")
            return True
            
        except Exception as e:
            print(f"✗ Error loading profile: {e}")
            return False
    
    def analyze_meta_info(self):
        """Analyze basic profile metadata."""
        meta = self.profile_data.get('meta', {})
        
        start_time = meta.get('startTime', 0)
        end_time = self.profile_data.get('profilingEndTime', 0)
        duration = (end_time - start_time) / 1000  # Convert to seconds
        
        analysis = {
            'duration_seconds': duration,
            'interval_ms': meta.get('interval', 0),
            'cpu_info': {
                'physical_cpus': self.profile_data.get('physicalCPUs', 0),
                'logical_cpus': self.profile_data.get('logicalCPUs', 0),
                'cpu_name': self.profile_data.get('CPUName', 'Unknown')
            },
            'firefox_version': meta.get('version', 'Unknown'),
            'platform': meta.get('platform', 'Unknown')
        }
        
        self.analysis_results['meta'] = analysis
        return analysis
    
    def analyze_pages(self):
        """Analyze loaded pages and identify sequence editor URLs."""
        pages = self.profile_data.get('pages', [])
        sequence_editor_pages = []
        
        for page in pages:
            url = page.get('url', '')
            if any(keyword in url.lower() for keyword in ['sequence', 'manage-sequences', 'editor']):
                sequence_editor_pages.append({
                    'tab_id': page.get('tabID'),
                    'url': url,
                    'window_id': page.get('innerWindowID'),
                    'is_private': page.get('isPrivateBrowsing', False)
                })
        
        analysis = {
            'total_pages': len(pages),
            'sequence_editor_pages': sequence_editor_pages,
            'target_application_detected': len(sequence_editor_pages) > 0
        }
        
        self.analysis_results['pages'] = analysis
        return analysis
    
    def analyze_threads(self):
        """Analyze thread activity and identify performance hotspots."""
        threads = self.profile_data.get('threads', [])
        thread_analysis = []
        
        for thread in threads:
            thread_name = thread.get('name', 'Unknown')
            samples = thread.get('samples', {})
            markers = thread.get('markers', {})
            
            sample_count = len(samples.get('data', []))
            marker_count = len(markers.get('data', []))
            
            thread_info = {
                'name': thread_name,
                'sample_count': sample_count,
                'marker_count': marker_count,
                'is_main_thread': 'Main' in thread_name or 'Gecko' in thread_name,
                'is_compositor': 'Compositor' in thread_name,
                'is_renderer': 'Renderer' in thread_name or 'Canvas' in thread_name
            }
            
            thread_analysis.append(thread_info)
        
        # Sort by activity level
        thread_analysis.sort(key=lambda x: x['sample_count'] + x['marker_count'], reverse=True)
        
        analysis = {
            'total_threads': len(threads),
            'threads': thread_analysis,
            'main_thread_samples': next((t['sample_count'] for t in thread_analysis if t['is_main_thread']), 0),
            'renderer_threads': [t for t in thread_analysis if t['is_renderer']]
        }
        
        self.analysis_results['threads'] = analysis
        return analysis
    
    def analyze_cpu_usage(self):
        """Analyze CPU usage patterns from counter data."""
        counters = self.profile_data.get('counters', [])
        cpu_analysis = {}
        
        for counter in counters:
            if counter.get('name') == 'processCPU':
                samples = counter.get('samples', {})
                time_deltas = samples.get('timeDeltas', [])
                count_values = samples.get('count', [])
                
                if count_values:
                    max_cpu = max(count_values)
                    avg_cpu = sum(count_values) / len(count_values)
                    
                    # Count high CPU periods (>50%)
                    high_cpu_periods = sum(1 for cpu in count_values if cpu > 50)
                    
                    cpu_analysis = {
                        'max_cpu_percent': max_cpu,
                        'average_cpu_percent': avg_cpu,
                        'high_cpu_periods': high_cpu_periods,
                        'total_samples': len(count_values),
                        'extreme_cpu_detected': max_cpu > 1000  # >10x normal usage
                    }
                break
        
        self.analysis_results['cpu'] = cpu_analysis
        return cpu_analysis
    
    def analyze_markers(self):
        """Analyze performance markers for bottlenecks."""
        threads = self.profile_data.get('threads', [])
        marker_analysis = {
            'total_markers': 0,
            'long_tasks': [],
            'gc_events': [],
            'layout_events': [],
            'javascript_events': [],
            'paint_events': []
        }
        
        for thread in threads:
            markers = thread.get('markers', {})
            marker_data = markers.get('data', [])
            marker_analysis['total_markers'] += len(marker_data)
            
            # Analyze marker types (simplified - would need full marker parsing)
            thread_name = thread.get('name', '')
            if 'Main' in thread_name:
                # Main thread markers are most critical
                marker_analysis['main_thread_markers'] = len(marker_data)
        
        self.analysis_results['markers'] = marker_analysis
        return marker_analysis
    
    def identify_bottlenecks(self):
        """Identify specific performance bottlenecks based on analysis."""
        bottlenecks = []
        
        # CPU bottlenecks
        cpu_data = self.analysis_results.get('cpu', {})
        if cpu_data.get('extreme_cpu_detected'):
            bottlenecks.append({
                'type': 'CPU',
                'severity': 'CRITICAL',
                'description': f"Extreme CPU usage detected: {cpu_data.get('max_cpu_percent', 0):.0f}%",
                'likely_cause': 'Infinite loops, expensive calculations, or inefficient algorithms',
                'code_locations': [
                    'waveform.js:375-420 - High-resolution waveform processing',
                    'sequence-editor-core.js:285-297 - Full DOM re-rendering',
                    'playback-controller.js:194-243 - Rapid UI updates'
                ]
            })
        
        # Thread bottlenecks
        thread_data = self.analysis_results.get('threads', {})
        if thread_data.get('main_thread_samples', 0) > 5000:
            bottlenecks.append({
                'type': 'MAIN_THREAD_BLOCKING',
                'severity': 'HIGH',
                'description': f"Main thread heavily loaded: {thread_data.get('main_thread_samples')} samples",
                'likely_cause': 'Canvas rendering, DOM manipulation, or synchronous operations',
                'code_locations': [
                    'waveform.js:257-276 - Canvas rendering in render()',
                    'sequence-editor-core.js:272-298 - DOM manipulation in renderContent()'
                ]
            })
        
        # Renderer thread issues
        renderer_threads = thread_data.get('renderer_threads', [])
        if len(renderer_threads) > 1:
            total_renderer_activity = sum(t['sample_count'] for t in renderer_threads)
            if total_renderer_activity > 10000:
                bottlenecks.append({
                    'type': 'GRAPHICS_RENDERING',
                    'severity': 'HIGH',
                    'description': f"Heavy graphics rendering activity across {len(renderer_threads)} threads",
                    'likely_cause': 'Inefficient canvas operations, frequent redraws, or lack of optimization',
                    'code_locations': [
                        'waveform.js:297-549 - Waveform drawing functions',
                        'waveform.js:240-255 - Animation loop in startPlaybackAnimation()'
                    ]
                })
        
        # Memory/Animation bottlenecks
        meta_data = self.analysis_results.get('meta', {})
        if meta_data.get('duration_seconds', 0) > 15:  # Long profiling session indicates sustained issues
            bottlenecks.append({
                'type': 'SUSTAINED_PERFORMANCE_ISSUES',
                'severity': 'MEDIUM',
                'description': f"Performance issues sustained over {meta_data.get('duration_seconds'):.1f} seconds",
                'likely_cause': 'Memory leaks, inefficient event handlers, or continuous heavy processing',
                'code_locations': [
                    'waveform.js:145-167 - Mouse move event handlers',
                    'playback-controller.js:225-242 - Continuous UI updates',
                    'sequence-editor-core.js:413-450 - Event dragging logic'
                ]
            })
        
        self.analysis_results['bottlenecks'] = bottlenecks
        return bottlenecks
    
    def generate_recommendations(self):
        """Generate specific optimization recommendations."""
        recommendations = {
            'immediate_fixes': [
                {
                    'priority': 'CRITICAL',
                    'area': 'Canvas Rendering',
                    'description': 'Implement canvas optimization strategies',
                    'actions': [
                        'Add dirty region tracking to avoid full redraws',
                        'Use offscreen canvas for static waveform rendering',
                        'Implement sample downsampling for high-resolution audio',
                        'Add performance.mark() timing around canvas operations'
                    ],
                    'files': ['static/js/sequence_editor/waveform.js:375-420', 'waveform.js:297-549']
                },
                {
                    'priority': 'HIGH',
                    'area': 'DOM Manipulation',
                    'description': 'Optimize DOM updates and rendering',
                    'actions': [
                        'Replace full container re-renders with incremental updates',
                        'Use DocumentFragment for batch DOM operations',
                        'Implement virtual scrolling for large event lists',
                        'Cache DOM queries and reuse elements'
                    ],
                    'files': ['static/js/sequence_editor/sequence-editor-core.js:272-298']
                },
                {
                    'priority': 'HIGH',
                    'area': 'Event Handling',
                    'description': 'Throttle and optimize event handlers',
                    'actions': [
                        'Debounce mouse move events to 32ms intervals',
                        'Use requestAnimationFrame for all animations',
                        'Implement passive event listeners where possible',
                        'Add event delegation for dynamic elements'
                    ],
                    'files': ['static/js/sequence_editor/waveform.js:145-167', 'playback-controller.js:194-243']
                }
            ],
            'performance_monitoring': [
                'Add performance.mark() and performance.measure() around critical operations',
                'Implement frame rate monitoring during playback',
                'Track memory usage during long editing sessions',
                'Monitor garbage collection frequency'
            ],
            'architectural_improvements': [
                'Move audio processing to Web Workers',
                'Implement canvas pooling for multiple waveforms',
                'Use WebGL for hardware-accelerated rendering',
                'Add progressive loading for large audio files'
            ]
        }
        
        self.analysis_results['recommendations'] = recommendations
        return recommendations
    
    def generate_report(self):
        """Generate a technical analysis report focused on measurable data."""
        print("\n" + "="*80)
        print("FIREFOX PERFORMANCE PROFILE TECHNICAL ANALYSIS")
        print("="*80)
        
        # Meta information
        meta = self.analysis_results.get('meta', {})
        print(f"\n📊 PROFILE METADATA")
        print(f"   Profiling duration: {meta.get('duration_seconds', 0):.1f} seconds")
        print(f"   Sample interval: {meta.get('interval_ms', 0)} ms")
        print(f"   CPU: {meta.get('cpu_info', {}).get('cpu_name', 'Unknown')}")
        print(f"   Physical cores: {meta.get('cpu_info', {}).get('physical_cpus', 0)}")
        print(f"   Logical cores: {meta.get('cpu_info', {}).get('logical_cpus', 0)}")
        print(f"   Firefox version: {meta.get('firefox_version', 'Unknown')}")
        print(f"   Platform: {meta.get('platform', 'Unknown')}")
        
        # Pages
        pages = self.analysis_results.get('pages', {})
        print(f"\n🌐 LOADED PAGES")
        print(f"   Total pages loaded: {pages.get('total_pages', 0)}")
        print(f"   Target application pages: {len(pages.get('sequence_editor_pages', []))}")
        for page in pages.get('sequence_editor_pages', []):
            print(f"   - Tab {page['tab_id']}: {page['url']}")
            print(f"     Window ID: {page['window_id']}, Private: {page['is_private']}")
        
        # CPU Analysis
        cpu = self.analysis_results.get('cpu', {})
        print(f"\n⚡ CPU UTILIZATION METRICS")
        if cpu:
            print(f"   Maximum CPU usage: {cpu.get('max_cpu_percent', 0):.1f}%")
            print(f"   Average CPU usage: {cpu.get('average_cpu_percent', 0):.1f}%")
            print(f"   Total samples: {cpu.get('total_samples', 0):,}")
            print(f"   High CPU periods (>50%): {cpu.get('high_cpu_periods', 0)}")
            high_cpu_ratio = (cpu.get('high_cpu_periods', 0) / max(cpu.get('total_samples', 1), 1)) * 100
            print(f"   High CPU period ratio: {high_cpu_ratio:.1f}%")
            
            if cpu.get('extreme_cpu_detected'):
                print(f"   ⚠️  ABNORMAL: CPU usage exceeded 1000% (multi-core saturation)")
        else:
            print("   No CPU utilization data available")
        
        # Thread Analysis
        threads = self.analysis_results.get('threads', {})
        print(f"\n🧵 THREAD EXECUTION ANALYSIS")
        print(f"   Total active threads: {threads.get('total_threads', 0)}")
        
        main_thread_samples = threads.get('main_thread_samples', 0)
        print(f"   Main thread samples: {main_thread_samples:,}")
        
        # Calculate thread activity distribution
        all_threads = threads.get('threads', [])
        total_samples = sum(t['sample_count'] for t in all_threads)
        total_markers = sum(t['marker_count'] for t in all_threads)
        
        print(f"   Total samples across all threads: {total_samples:,}")
        print(f"   Total markers across all threads: {total_markers:,}")
        
        if total_samples > 0:
            main_thread_ratio = (main_thread_samples / total_samples) * 100
            print(f"   Main thread activity ratio: {main_thread_ratio:.1f}%")
        
        print(f"\n   Top 5 most active threads:")
        active_threads = sorted([t for t in all_threads], key=lambda x: x['sample_count'], reverse=True)
        for i, thread in enumerate(active_threads[:5]):
            activity_ratio = (thread['sample_count'] / max(total_samples, 1)) * 100
            print(f"   {i+1}. {thread['name']}")
            print(f"      Samples: {thread['sample_count']:,} ({activity_ratio:.1f}%)")
            print(f"      Markers: {thread['marker_count']:,}")
            print(f"      Type: {'Main' if thread['is_main_thread'] else 'Compositor' if thread['is_compositor'] else 'Renderer' if thread['is_renderer'] else 'Worker'}")
        
        # Renderer thread analysis
        renderer_threads = threads.get('renderer_threads', [])
        if renderer_threads:
            print(f"\n   Rendering thread analysis:")
            print(f"   Active renderer threads: {len(renderer_threads)}")
            renderer_samples = sum(t['sample_count'] for t in renderer_threads)
            renderer_markers = sum(t['marker_count'] for t in renderer_threads)
            print(f"   Total renderer samples: {renderer_samples:,}")
            print(f"   Total renderer markers: {renderer_markers:,}")
            if total_samples > 0:
                renderer_ratio = (renderer_samples / total_samples) * 100
                print(f"   Renderer activity ratio: {renderer_ratio:.1f}%")
        
        # Marker Analysis
        markers = self.analysis_results.get('markers', {})
        print(f"\n📊 PERFORMANCE MARKERS")
        print(f"   Total markers recorded: {markers.get('total_markers', 0):,}")
        main_markers = markers.get('main_thread_markers', 0)
        if main_markers > 0:
            print(f"   Main thread markers: {main_markers:,}")
            marker_density = main_markers / max(meta.get('duration_seconds', 1), 1)
            print(f"   Marker density: {marker_density:.1f} markers/second")
        
        # Technical Issue Detection
        print(f"\n🔍 TECHNICAL ISSUE ANALYSIS")
        
        issues_found = []
        
        # CPU saturation analysis
        if cpu.get('max_cpu_percent', 0) > 800:
            issues_found.append("CPU_SATURATION")
            print(f"   ❌ CPU SATURATION: {cpu.get('max_cpu_percent', 0):.0f}% exceeds 8-core capacity")
        elif cpu.get('max_cpu_percent', 0) > 400:
            issues_found.append("HIGH_CPU_USAGE")
            print(f"   ⚠️  HIGH CPU USAGE: {cpu.get('max_cpu_percent', 0):.0f}% indicates heavy computation")
        
        # Main thread blocking analysis
        if main_thread_samples > 10000:
            issues_found.append("MAIN_THREAD_BLOCKING")
            print(f"   ❌ MAIN THREAD BLOCKING: {main_thread_samples:,} samples indicate UI blocking")
        elif main_thread_samples > 5000:
            issues_found.append("MAIN_THREAD_BUSY")
            print(f"   ⚠️  MAIN THREAD BUSY: {main_thread_samples:,} samples indicate heavy main thread load")
        
        # Rendering thread analysis
        if renderer_samples > 15000:
            issues_found.append("EXCESSIVE_RENDERING")
            print(f"   ❌ EXCESSIVE RENDERING: {renderer_samples:,} renderer samples indicate graphics bottleneck")
        elif renderer_samples > 8000:
            issues_found.append("HIGH_RENDERING_LOAD")
            print(f"   ⚠️  HIGH RENDERING LOAD: {renderer_samples:,} renderer samples")
        
        # Marker density analysis
        if main_markers > 0:
            marker_density = main_markers / max(meta.get('duration_seconds', 1), 1)
            if marker_density > 1000:
                issues_found.append("HIGH_MARKER_DENSITY")
                print(f"   ❌ HIGH MARKER DENSITY: {marker_density:.0f} markers/sec indicates frequent operations")
            elif marker_density > 500:
                issues_found.append("MODERATE_MARKER_DENSITY")
                print(f"   ⚠️  MODERATE MARKER DENSITY: {marker_density:.0f} markers/sec")
        
        # Long profiling session analysis
        duration = meta.get('duration_seconds', 0)
        if duration > 30:
            issues_found.append("SUSTAINED_ISSUES")
            print(f"   ⚠️  SUSTAINED ISSUES: {duration:.1f}s profiling suggests persistent performance problems")
        
        if not issues_found:
            print(f"   ✅ No critical technical issues detected")
        
        # Summary statistics
        print(f"\n📈 PERFORMANCE SUMMARY")
        print(f"   Issues detected: {len(issues_found)}")
        if issues_found:
            print(f"   Issue types: {', '.join(issues_found)}")
        
        print(f"   CPU efficiency: {100 - min(cpu.get('average_cpu_percent', 0) / 100 * 100, 100):.1f}% available")
        print(f"   Thread distribution: {len(active_threads)} active threads")
        print(f"   Rendering load: {len(renderer_threads)} renderer threads active")
        
        # Raw data summary for developers
        print(f"\n🔧 DEVELOPER DATA POINTS")
        print(f"   Profile file size: {os.path.getsize(self.profile_path) / (1024*1024):.1f} MB")
        print(f"   Sample collection rate: {1000 / max(meta.get('interval_ms', 1), 1):.1f} Hz")
        print(f"   Total data points: {total_samples:,} samples + {total_markers:,} markers")
        print(f"   Data density: {(total_samples + total_markers) / max(duration, 1):.0f} points/second")
        
        print(f"\n" + "="*80)
        print("END OF TECHNICAL ANALYSIS")
        print("="*80)
    
    def save_detailed_report(self, output_file=None):
        """Save detailed analysis to JSON file."""
        if not output_file:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_file = f"firefox_profile_analysis_{timestamp}.json"
        
        try:
            with open(output_file, 'w') as f:
                json.dump(self.analysis_results, f, indent=2)
            print(f"\n💾 Detailed analysis saved to: {output_file}")
        except Exception as e:
            print(f"✗ Error saving analysis: {e}")
    
    def save_text_report(self, output_file):
        """Save human-readable text report."""
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                # Redirect print output to file
                import io
                import contextlib
                
                # Capture the report output
                string_buffer = io.StringIO()
                with contextlib.redirect_stdout(string_buffer):
                    self.generate_report()
                
                # Write to file
                report_content = string_buffer.getvalue()
                f.write(report_content)
                
            print(f"💾 Text report saved to: {output_file}")
        except Exception as e:
            print(f"✗ Error saving text report: {e}")
    
    def run_full_analysis(self):
        """Run complete analysis pipeline."""
        if not self.load_profile():
            return False
        
        print("🔍 Analyzing profile metadata...")
        self.analyze_meta_info()
        
        print("🔍 Analyzing pages and URLs...")
        self.analyze_pages()
        
        print("🔍 Analyzing thread activity...")
        self.analyze_threads()
        
        print("🔍 Analyzing CPU usage patterns...")
        self.analyze_cpu_usage()
        
        print("🔍 Analyzing performance markers...")
        self.analyze_markers()
        
        print("🔍 Identifying bottlenecks...")
        self.identify_bottlenecks()
        
        print("🔍 Generating recommendations...")
        self.generate_recommendations()
        
        print("✓ Analysis complete!")
        return True


def main():
    # Check if profile file is provided as argument
    if len(sys.argv) == 2:
        profile_path = sys.argv[1]
    else:
        # Look for profile files in the analyze directory
        analyze_dir = os.path.dirname(os.path.abspath(__file__))
        profile_files = []
        
        for file in os.listdir(analyze_dir):
            if file.startswith("Firefox") and (file.endswith(".json.gz") or file.endswith(".json")):
                profile_files.append(os.path.join(analyze_dir, file))
        
        if not profile_files:
            print("Usage: python firefox_profile_analyzer.py <profile.json.gz|profile.json>")
            print("Or drop a Firefox profile file in the analyze directory and run without arguments")
            print("\nExample:")
            print('  python firefox_profile_analyzer.py "Firefox 2025-06-21 15.43 profile.json.gz"')
            sys.exit(1)
        elif len(profile_files) == 1:
            profile_path = profile_files[0]
            print(f"📁 Found profile file: {os.path.basename(profile_path)}")
        else:
            print("Multiple profile files found. Please specify which one to analyze:")
            for i, file in enumerate(profile_files):
                print(f"  {i+1}. {os.path.basename(file)}")
            sys.exit(1)
    
    if not os.path.exists(profile_path):
        print(f"✗ Profile file not found: {profile_path}")
        sys.exit(1)
    
    # Create directory structure and move profile
    profile_name = os.path.basename(profile_path)
    # Remove file extension for directory name
    if profile_name.endswith('.json.gz'):
        dir_name = profile_name[:-8]  # Remove .json.gz
    elif profile_name.endswith('.json'):
        dir_name = profile_name[:-5]  # Remove .json
    else:
        dir_name = profile_name
    
    # Create analysis directory
    analyze_dir = os.path.dirname(os.path.abspath(__file__))
    profile_dir = os.path.join(analyze_dir, dir_name)
    
    try:
        os.makedirs(profile_dir, exist_ok=True)
        print(f"📁 Created analysis directory: {dir_name}")
        
        # Move profile to its directory
        moved_profile_path = os.path.join(profile_dir, profile_name)
        if profile_path != moved_profile_path:
            import shutil
            shutil.move(profile_path, moved_profile_path)
            print(f"📦 Moved profile to: {moved_profile_path}")
            profile_path = moved_profile_path
        
    except Exception as e:
        print(f"✗ Error creating directory structure: {e}")
        sys.exit(1)
    
    # Run analysis
    analyzer = FirefoxProfileAnalyzer(profile_path)
    
    if analyzer.run_full_analysis():
        # Generate console report
        analyzer.generate_report()
        
        # Save detailed JSON analysis
        json_output = os.path.join(profile_dir, f"{dir_name}_analysis.json")
        analyzer.save_detailed_report(json_output)
        
        # Generate and save text report
        report_output = os.path.join(profile_dir, f"{dir_name}_Report.txt")
        analyzer.save_text_report(report_output)
        
        print(f"\n✅ Analysis complete! Files saved in: {profile_dir}")
        print(f"   📊 JSON Analysis: {os.path.basename(json_output)}")
        print(f"   📄 Text Report: {os.path.basename(report_output)}")
        
    else:
        print("✗ Analysis failed")
        sys.exit(1)


if __name__ == "__main__":
    main()