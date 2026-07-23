bl_info = {
    "name": "Woxengine Scene Exporter (.wscene)",
    "author": "Antigravity",
    "version": (1, 0),
    "blender": (3, 0, 0),
    "location": "File > Export > Woxengine Scene (.wscene)",
    "description": "Export Blender scenes directly to Woxengine .wscene with Live-Sync support.",
    "category": "Import-Export",
}

import bpy
import os
import json
import struct
import base64
import tempfile
import time
import urllib.request
import urllib.error
from bpy_extras.io_utils import ExportHelper
from bpy.props import StringProperty, BoolProperty, EnumProperty, IntProperty
from bpy.types import Operator, Panel

# Globals for Live-Sync debounce
last_sync_time = 0.0
sync_timer_scheduled = False
is_syncing = False

def get_object_world_yup_transform(obj, gltf_json=None):
    """Calculates exact world position, orientation quaternion and Euler, and scale converted to Three.js Y-up space."""
    import mathutils
    
    mat = obj.matrix_world
    loc, rot_quat, scl = mat.decompose()
    
    # Convert Blender Z-Up (X-right, Y-forward, Z-up) to Three.js Y-Up (X-right, Y-up, -Z-forward)
    pos = [loc.x, loc.z, -loc.y]
    
    # Convert Quaternion from Blender (w, x, y, z) to Three.js Y-Up: (x, z, -y, w)
    q_three = mathutils.Quaternion((rot_quat.w, rot_quat.x, rot_quat.z, -rot_quat.y))
    euler_three = q_three.to_euler('XYZ')
    
    quat = [q_three.x, q_three.y, q_three.z, q_three.w]
    rot = [euler_three.x, euler_three.y, euler_three.z]
    scale = [scl.x, scl.z, scl.y]
    
    return {
        "p": pos,
        "q": quat,
        "r": rot,
        "s": scale
    }

def export_wscene_data(context, max_texture_size, export_filepath=None, project_name="default_project", level_index=0, project_path=""):
    """Performs the export and resizing. Returns a dict representing the .wscene data."""
    # 1. Resize textures temporarily if requested
    scaled_images = []
    if max_texture_size != 'UNLIMITED':
        max_size = int(max_texture_size)
        for img in bpy.data.images:
            if img.filepath and img.type == 'IMAGE' and img.size:
                w, h = img.size[0], img.size[1]
                if max(w, h) > max_size:
                    factor = max_size / max(w, h)
                    new_w = int(w * factor)
                    new_h = int(h * factor)
                    # Backup scale
                    img.scale(new_w, new_h)
                    scaled_images.append(img)

    # 2. Determine glb path (project_path or temp)
    write_direct = False
    if project_path and os.path.isdir(project_path):
        glb_dir = os.path.join(project_path, 'assets')
        os.makedirs(glb_dir, exist_ok=True)
        glb_filename = f"blender_sync_{level_index}.glb"
        glb_path = os.path.join(glb_dir, glb_filename)
        write_direct = True
    else:
        temp_dir = tempfile.gettempdir()
        glb_filename = "temp_wox_export.glb"
        glb_path = os.path.join(temp_dir, glb_filename)
    
    try:
        # Use Blender built-in gltf exporter
        bpy.ops.export_scene.gltf(
            filepath=glb_path,
            export_format='GLB'
        )
    except Exception as e:
        # Restore images before raising error
        for img in scaled_images:
            img.reload()
        raise e

    # 3. Read GLB file and extract JSON chunk (Chunk 0)
    gltf_json = {}
    glb_base64 = ""
    if os.path.exists(glb_path):
        with open(glb_path, 'rb') as f:
            if not write_direct:
                glb_data = f.read()
                glb_base64 = "data:model/gltf-binary;base64," + base64.b64encode(glb_data).decode('utf-8')
            
            # Read header
            f.seek(0)
            header = f.read(12)
            if len(header) == 12:
                magic, version, length = struct.unpack('<4sII', header)
                if magic == b'glTF':
                    chunk_header = f.read(8)
                    if len(chunk_header) == 8:
                        chunk_length, chunk_type = struct.unpack('<II', chunk_header)
                        if chunk_type == 0x4E4F534A: # JSON
                            json_data = f.read(chunk_length).decode('utf-8')
                            try:
                                gltf_json = json.loads(json_data)
                            except Exception as json_err:
                                print("Error parsing glTF JSON chunk:", json_err)
        
        if not write_direct:
            try:
                os.remove(glb_path)
            except:
                pass

    # 4. Restore original image sizes
    for img in scaled_images:
        img.reload()

    # 5. Extract environment, EEVEE, and level settings
    scene = context.scene
    eevee = getattr(scene, 'eevee', None)
    
    bloom_enabled = getattr(eevee, 'use_bloom', False) if eevee else False
    bloom_intensity = getattr(eevee, 'bloom_intensity', 0.5) if eevee else 0.5
    bloom_radius = getattr(eevee, 'bloom_radius', 0.4) if eevee else 0.4
    
    ssao_enabled = getattr(eevee, 'use_gtao', True) if eevee else True
    ssao_distance = getattr(eevee, 'gtao_distance', 0.2) if eevee else 0.2
    
    ssr_enabled = getattr(eevee, 'use_ssr', False) if eevee else False
    
    view_settings = getattr(scene, 'view_settings', None)
    exposure = getattr(view_settings, 'exposure', 0.0) if view_settings else 0.0
    import math
    exposure_mult = math.pow(2, exposure)

    level_settings = {
        "gamePBR": True,
        "gameShadows": True,
        "gameReflections": True,
        "gameExposure": exposure_mult,
        "gameAmbientColor": "#b58aa5",
        "gameAmbientIntensity": 0.6,
        "gameBloomEffect": bloom_enabled,
        "gameBloomStrength": bloom_intensity,
        "gameBloomRadius": bloom_radius,
        "gameSSAOEffect": ssao_enabled,
        "gameSSAODistance": ssao_distance,
        "gameSSREffect": ssr_enabled,
        "gameSSRIntensity": 0.45
    }
    
    # Try to extract ambient color from World background
    if context.scene.world and context.scene.world.node_tree:
        for node in context.scene.world.node_tree.nodes:
            if node.type == 'BACKGROUND':
                if not node.inputs[0].is_linked:
                    color = node.inputs[0].default_value
                    r = int(color[0] * 255)
                    g = int(color[1] * 255)
                    b = int(color[2] * 255)
                    level_settings["gameAmbientColor"] = f"#{r:02x}{g:02x}{b:02x}"
                level_settings["gameAmbientIntensity"] = float(node.inputs[1].default_value)
                break

    # 6. Parse and map objects to Woxengine format
    wscene_objects = []
    for obj in context.scene.objects:
        if obj.hide_viewport or obj.hide_render:
            pass
            
        transform = get_object_world_yup_transform(obj, gltf_json)

        obj_data = {
            "name": obj.name,
            "p": transform["p"],
            "q": transform.get("q"),
            "r": transform["r"],
            "s": transform["s"],
            "userData": {}
        }

        if obj.type == 'LIGHT':
            light = obj.data
            l_type = "PointLight"
            if light.type == 'SUN':
                l_type = "DirectionalLight"
            elif light.type == 'SPOT' or light.type == 'AREA':
                l_type = "SpotLight"
                
            col = light.color
            r = int(col[0] * 255)
            g = int(col[1] * 255)
            b = int(col[2] * 255)
            hex_color = f"#{r:02x}{g:02x}{b:02x}"
            
            intensity = light.energy * 0.1
            if light.type == 'SUN':
                intensity = light.energy
            elif light.type == 'AREA':
                intensity = light.energy * 0.2
                
            obj_data["type"] = l_type
            obj_data["userData"] = {
                "type": l_type,
                "isAsset": True,
                "color": hex_color,
                "intensity": intensity,
                "distance": getattr(light, 'cutoff_distance', 0.0) or 0.0,
                "castShadow": getattr(light, 'use_shadow', True),
                "shadowRes": 2048 if getattr(light, 'use_shadow', True) else 1024,
                "shadowBias": -0.0005
            }
            if light.type in ('SPOT', 'AREA'):
                obj_data["userData"]["angle"] = getattr(light, 'spot_size', 1.0)
                obj_data["userData"]["penumbra"] = getattr(light, 'spot_blend', 0.5)

        elif obj.type == 'CAMERA':
            cam = obj.data
            obj_data["type"] = "Camera"
            import math
            fov = math.degrees(cam.angle)
            isActive = (context.scene.camera == obj)
            obj_data["userData"] = {
                "isCamera": True,
                "fov": fov,
                "near": cam.clip_start,
                "far": cam.clip_end,
                "isActive": isActive,
                "type": "8WAY"
            }
            
        elif obj.type in ('MESH', 'ARMATURE', 'CURVE', 'FONT', 'SURFACE', 'META'):
            obj_data["type"] = "Model"
            obj_data["glbNodeName"] = obj.name
            obj_data["userData"] = {
                "type": "Model",
                "isAsset": True,
                "glbNodeName": obj.name
            }
        else:
            obj_data["type"] = "Model"
            obj_data["glbNodeName"] = obj.name
            obj_data["userData"] = {
                "type": "Model",
                "isAsset": True,
                "glbNodeName": obj.name
            }
            
        wscene_objects.append(obj_data)

    # 7. Construct final .wscene structure
    wscene_data = {
        "format": "wscene",
        "version": "1.0",
        "settings": {
            "textureLimit": max_texture_size
        },
        "levelSettings": level_settings,
        "objects": wscene_objects,
        "glb": glb_base64
    }

    if write_direct:
        wscene_data["glbSource"] = f"projects/{project_name}/assets/blender_sync_{level_index}.glb"

    return wscene_data

# --- OPERATOR: Export to file ---
class EXPORT_OT_wscene(Operator, ExportHelper):
    """Export scene to Woxengine .wscene file"""
    bl_idname = "export_scene.wscene"
    bl_label = "Export WScene"
    bl_options = {'PRESET', 'UNDO'}

    filename_ext = ".wscene"

    filter_glob: StringProperty(
        default="*.wscene",
        options={'HIDDEN'},
        maxlen=255,
    )

    max_texture_size: EnumProperty(
        name="Max Texture Size",
        description="Limit the resolution of exported textures to optimize memory usage",
        items=[
            ('256', '256 px', 'Limit textures to 256x256 px'),
            ('512', '512 px', 'Limit textures to 512x512 px'),
            ('1024', '1024 px', 'Limit textures to 1024x1024 px'),
            ('2048', '2048 px', 'Limit textures to 2048x2048 px'),
            ('UNLIMITED', 'No Limit', 'Do not resize texture images'),
        ],
        default='1024',
    )

    def execute(self, context):
        try:
            wscene_data = export_wscene_data(context, self.max_texture_size, self.filepath)
            with open(self.filepath, 'w', encoding='utf-8') as f:
                json.dump(wscene_data, f, indent=2, ensure_ascii=False)
            self.report({'INFO'}, f"Scene successfully exported to {self.filepath}")
            return {'FINISHED'}
        except Exception as e:
            self.report({'ERROR'}, f"Failed to export scene: {str(e)}")
            return {'CANCELLED'}

# --- OPERATOR: Live-Sync Now ---
class EXPORT_OT_wscene_sync_now(Operator):
    """Force immediately sync current scene to active Woxengine editor"""
    bl_idname = "export_scene.wscene_sync_now"
    bl_label = "Sync Scene Now"

    def execute(self, context):
        global is_syncing
        if is_syncing:
            return {'CANCELLED'}
        is_syncing = True

        level_select = context.scene.wscene_level_select
        max_texture_size = context.scene.wscene_max_tex_size
        project_path = context.scene.wscene_project_path
        
        if project_path:
            project_name = os.path.basename(os.path.normpath(project_path))
        else:
            project_name = "default_project"

        level_index = level_select
        if level_index != 'NEW':
            try:
                level_index = int(level_select)
            except:
                level_index = 0

        try:
            wscene_data = export_wscene_data(context, max_texture_size, project_name=project_name, level_index=level_index, project_path=project_path)
            
            # Send POST to local Woxengine server
            payload = {
                "projectName": project_name,
                "levelIndex": level_index,
                "wscene": wscene_data
            }
            
            url = "http://127.0.0.1:8000/api/blender-sync"
            req_data = json.dumps(payload).encode('utf-8')
            
            req = urllib.request.Request(
                url, 
                data=req_data, 
                headers={'Content-Type': 'application/json'}
            )
            
            # Set timeout to 1s to avoid blocking Blender interface if engine is closed
            with urllib.request.urlopen(req, timeout=1.0) as response:
                res = json.loads(response.read().decode('utf-8'))
                if res.get('success'):
                    # Success
                    pass
            return {'FINISHED'}
        except Exception as e:
            print("Woxengine Sync Error:", e)
            # We don't spam errors on auto-sync if server is down, only in manual trigger
            if not context.scene.wscene_live_sync:
                self.report({'WARNING'}, f"Sync failed: {str(e)}. Make sure Woxengine server is running.")
            return {'CANCELLED'}
        finally:
            global last_sync_time
            last_sync_time = time.time()
            is_syncing = False

# --- DEFERRED SYNC AND HANDLER ---
def deferred_sync():
    global sync_timer_scheduled
    sync_timer_scheduled = False
    
    # Check if live sync is still active
    try:
        scene = getattr(bpy.context, 'scene', None)
        if not scene and len(bpy.data.scenes) > 0:
            scene = bpy.data.scenes[0]
        if scene and getattr(scene, 'wscene_live_sync', False):
            bpy.ops.export_scene.wscene_sync_now()
    except Exception as e:
        print("Error during live sync callback:", e)
        
    return None # Do not repeat timer

def depsgraph_update_handler(scene, *args):
    global sync_timer_scheduled, last_sync_time, is_syncing
    
    if is_syncing:
        return

    # Ignore updates that happen within 1.0 second of the last completed sync
    if time.time() - last_sync_time < 1.0:
        return
    
    # If live sync is not active, do nothing
    if not getattr(scene, 'wscene_live_sync', False):
        return
        
    # Check if we should trigger sync (debounce delay of 0.3s)
    now = time.time()
    if not sync_timer_scheduled:
        sync_timer_scheduled = True
        # Schedule deferred_sync to run in 0.3 seconds
        bpy.app.timers.register(deferred_sync, first_interval=0.3)

# --- PANEL IN VIEW3D SIDEBAR (N-Panel) ---
class VIEW3D_PT_wscene_sync(Panel):
    bl_label = "Woxengine Live Sync"
    bl_idname = "VIEW3D_PT_wscene_sync"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Woxengine"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        
        layout.prop(scene, "wscene_project_path")
        layout.prop(scene, "wscene_level_select")
        layout.prop(scene, "wscene_max_tex_size")
        
        layout.separator()
        
        layout.prop(scene, "wscene_live_sync", toggle=True, icon='LOOP_BACK')
        layout.operator("export_scene.wscene_sync_now", icon='PLAY')

# --- REGISTRATION ---
def get_levels_items(self, context):
    items = []
    project_path = getattr(context.scene, "wscene_project_path", "")
    if project_path and os.path.isdir(project_path):
        json_path = os.path.join(project_path, 'project.json')
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    levels = data.get('levels', [])
                    for i, lvl in enumerate(levels):
                        name = lvl.get('name', f"Level {i}")
                        items.append((str(i), f"{i}: {name}", f"Sync to {name}"))
            except Exception as e:
                print("Error reading project.json in get_levels_items callback:", e)
    
    # Option to create a new scene/level in Woxengine
    items.append(('NEW', "＋ Nuova Scena (Crea)", "Create a new level scene in woxengine"))
    
    # Ensure there is at least one fallback item so Blender doesn't crash on empty enum
    if len(items) == 1:
        items.insert(0, ('0', "0: Default Level", "Sync to level 0"))
        
    return items

def menu_func_export(self, context):
    self.layout.operator(EXPORT_OT_wscene.bl_idname, text="Woxengine Scene (.wscene)")

classes = (
    EXPORT_OT_wscene,
    EXPORT_OT_wscene_sync_now,
    VIEW3D_PT_wscene_sync,
)

def register():
    for cls in classes:
        try:
            bpy.utils.register_class(cls)
        except Exception:
            pass

    try:
        bpy.types.TOPBAR_MT_file_export.append(menu_func_export)
    except Exception:
        pass

    # Register custom scene properties
    bpy.types.Scene.wscene_project_path = StringProperty(
        name="Project Path",
        description="Path to the active woxengine project directory (containing assets/ and levels/)",
        default="",
        subtype='DIR_PATH'
    )
    
    bpy.types.Scene.wscene_level_select = EnumProperty(
        name="Target Level",
        description="Select the level to sync to in woxengine",
        items=get_levels_items
    )
    
    bpy.types.Scene.wscene_max_tex_size = EnumProperty(
        name="Max Texture Size",
        description="Limit resolution of synced textures",
        items=[
            ('256', '256 px', '256 px'),
            ('512', '512 px', '512 px'),
            ('1024', '1024 px', '1024 px'),
            ('2048', '2048 px', '2048 px'),
            ('UNLIMITED', 'No Limit', 'No Limit'),
        ],
        default='1024'
    )
    
    bpy.types.Scene.wscene_live_sync = BoolProperty(
        name="Live Auto-Sync",
        description="Automatically update woxengine on modifications",
        default=False
    )

    # Register depsgraph handler for live sync
    if depsgraph_update_handler not in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.append(depsgraph_update_handler)

def unregister():
    if depsgraph_update_handler in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.remove(depsgraph_update_handler)

    for cls in reversed(classes):
        try:
            bpy.utils.unregister_class(cls)
        except Exception:
            pass

    try:
        bpy.types.TOPBAR_MT_file_export.remove(menu_func_export)
    except Exception:
        pass

    for prop in ["wscene_project_path", "wscene_level_select", "wscene_max_tex_size", "wscene_live_sync"]:
        if hasattr(bpy.types.Scene, prop):
            delattr(bpy.types.Scene, prop)

if __name__ == "__main__":
    register()

