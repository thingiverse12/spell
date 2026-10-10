extends Node3D
## Procedurellt genererad, oändlig öppen värld.
## Terrängen delas upp i chunks som laddas och tas bort när spelaren rör sig.
## Varje chunk innehåller terräng, kollision, träd, buskar, stenar, blommor och ibland ruiner.

const CHUNK_SIZE := 48.0      # världsenheter per chunk (sida)
const RESOLUTION := 48        # antal rutor per chunk-sida (1 enhet per ruta)
const VIEW_RADIUS := 3        # antal chunks som laddas åt varje håll runt spelaren
const WATER_LEVEL := 0.0
const CHUNKS_PER_FRAME := 1   # hur många chunks som byggs per bildruta (jämnar ut lagg)

var world_seed := 1337

var _continent := FastNoiseLite.new()
var _detail := FastNoiseLite.new()
var _mountain := FastNoiseLite.new()
var _forest := FastNoiseLite.new()

var _chunks := {}              # Vector2i -> Node3D
var _pending: Array[Vector2i] = []
var _center := Vector2i(1000000, 1000000)
var _water: MeshInstance3D

var _terrain_mat: StandardMaterial3D
var _trunk_mat: StandardMaterial3D
var _foliage_mat: StandardMaterial3D
var _rock_mat: StandardMaterial3D
var _flower_mat: StandardMaterial3D
var _stone_mat: StandardMaterial3D
var _trunk_mesh: CylinderMesh
var _crown_mesh: CylinderMesh
var _bush_mesh: SphereMesh
var _rock_mesh: SphereMesh
var _flower_mesh: SphereMesh


func _ready() -> void:
	_setup_noise()
	_setup_assets()
	_setup_water()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

## Höjden (y) på terrängen i världskoordinater. Samma funktion används för
## terräng, träd och spawn, så allt stämmer med varandra.
func height_at(x: float, z: float) -> float:
	var c := _continent.get_noise_2d(x, z) + 0.12  # lite extra land
	var land := smoothstep(-0.1, 0.2, c)
	var h := c * 26.0
	h += _detail.get_noise_2d(x, z) * 4.0 * land
	var ridge := maxf(_mountain.get_noise_2d(x, z), 0.0)
	h += ridge * ridge * 42.0 * smoothstep(0.05, 0.4, c)
	# Platt startzon kring origo så spelaren inte hamnar i vattnet.
	var dist := Vector2(x, z).length()
	var spawn_weight := 1.0 - smoothstep(12.0, 50.0, dist)
	return lerpf(h, 3.0, spawn_weight)


## Anropas varje bildruta med spelarens position. Laddar och tar bort chunks.
## Med immediate = true byggs chunks nära spelaren direkt (används vid start).
func update_focus(p: Vector3, immediate := false) -> void:
	_water.position.x = p.x
	_water.position.z = p.z
	var cc := _chunk_of(p)
	if cc == _center and not immediate:
		return
	_center = cc
	_refresh_chunks()
	if immediate:
		for dz in range(-1, 2):
			for dx in range(-1, 2):
				var key := cc + Vector2i(dx, dz)
				if not _chunks.has(key):
					_chunks[key] = _build_chunk(key)


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

func _setup_noise() -> void:
	_continent.seed = world_seed
	_continent.frequency = 0.0035
	_continent.fractal_type = FastNoiseLite.FRACTAL_FBM
	_continent.fractal_octaves = 4

	_detail.seed = world_seed + 1
	_detail.frequency = 0.03
	_detail.fractal_octaves = 3

	_mountain.seed = world_seed + 2
	_mountain.frequency = 0.008
	_mountain.fractal_type = FastNoiseLite.FRACTAL_RIDGED
	_mountain.fractal_octaves = 4

	_forest.seed = world_seed + 3
	_forest.frequency = 0.012
	_forest.fractal_octaves = 2


func _setup_assets() -> void:
	_terrain_mat = _material(Color.WHITE, 0.95, true)
	_trunk_mat = _material(Color(0.42, 0.27, 0.14), 0.9, true)
	_foliage_mat = _material(Color(0.25, 0.5, 0.2), 0.85, true)
	_rock_mat = _material(Color(0.5, 0.48, 0.46), 0.95, true)
	_flower_mat = _material(Color.WHITE, 0.6, true)
	_stone_mat = _material(Color(0.6, 0.58, 0.52), 0.9, false)

	_trunk_mesh = CylinderMesh.new()
	_trunk_mesh.top_radius = 0.25
	_trunk_mesh.bottom_radius = 0.35
	_trunk_mesh.height = 4.0
	_trunk_mesh.radial_segments = 6

	_crown_mesh = CylinderMesh.new()
	_crown_mesh.top_radius = 0.0
	_crown_mesh.bottom_radius = 2.2
	_crown_mesh.height = 4.2
	_crown_mesh.radial_segments = 7

	_bush_mesh = SphereMesh.new()
	_bush_mesh.radius = 0.9
	_bush_mesh.height = 1.2
	_bush_mesh.radial_segments = 8
	_bush_mesh.rings = 4

	_rock_mesh = SphereMesh.new()
	_rock_mesh.radius = 1.0
	_rock_mesh.height = 1.4
	_rock_mesh.radial_segments = 8
	_rock_mesh.rings = 4

	_flower_mesh = SphereMesh.new()
	_flower_mesh.radius = 0.12
	_flower_mesh.height = 0.24
	_flower_mesh.radial_segments = 5
	_flower_mesh.rings = 3


func _setup_water() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(4000.0, 4000.0)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.12, 0.38, 0.62, 0.8)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.roughness = 0.08
	mat.metallic = 0.1
	plane.material = mat
	_water = MeshInstance3D.new()
	_water.mesh = plane
	_water.position.y = WATER_LEVEL
	add_child(_water)


func _material(color: Color, roughness: float, use_vertex_color: bool) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	m.vertex_color_use_as_albedo = use_vertex_color
	return m


# ---------------------------------------------------------------------------
# Chunk streaming
# ---------------------------------------------------------------------------

func _process(_delta: float) -> void:
	var built := 0
	while built < CHUNKS_PER_FRAME and not _pending.is_empty():
		var key: Vector2i = _pending.pop_front()
		if _chebyshev(key, _center) > VIEW_RADIUS or _chunks.has(key):
			continue
		_chunks[key] = _build_chunk(key)
		built += 1


func _refresh_chunks() -> void:
	# Ta bort chunks som ligger för långt bort.
	for key in _chunks.keys():
		if _chebyshev(key, _center) > VIEW_RADIUS + 1:
			_chunks[key].queue_free()
			_chunks.erase(key)
	# Köa chunks som saknas, närmast spelaren först.
	_pending.clear()
	for dz in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
		for dx in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
			var key := _center + Vector2i(dx, dz)
			if not _chunks.has(key):
				_pending.append(key)
	var center := _center
	_pending.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		return (a - center).length_squared() < (b - center).length_squared())


func _chunk_of(p: Vector3) -> Vector2i:
	return Vector2i(floori(p.x / CHUNK_SIZE), floori(p.z / CHUNK_SIZE))


func _chebyshev(a: Vector2i, b: Vector2i) -> int:
	return maxi(absi(a.x - b.x), absi(a.y - b.y))


# ---------------------------------------------------------------------------
# Chunk building
# ---------------------------------------------------------------------------

func _build_chunk(key: Vector2i) -> Node3D:
	var root := Node3D.new()
	root.name = "Chunk_%d_%d" % [key.x, key.y]
	add_child(root)

	var origin := Vector2(key.x * CHUNK_SIZE, key.y * CHUNK_SIZE)
	var step := CHUNK_SIZE / RESOLUTION
	var n := RESOLUTION + 1

	# Höjddata för hela chunken (inklusive kanter så att chunks sluter sig mot varandra).
	var heights := PackedFloat32Array()
	heights.resize(n * n)
	for j in n:
		for i in n:
			heights[j * n + i] = height_at(origin.x + i * step, origin.y + j * step)

	# Normal och färg räknas en gång per rutnätspunkt (inte per triangelhörn).
	var normals := PackedVector3Array()
	normals.resize(n * n)
	var colors := PackedColorArray()
	colors.resize(n * n)
	for j in n:
		for i in n:
			var idx := j * n + i
			var normal := _grid_normal(heights, i, j, step)
			normals[idx] = normal
			colors[idx] = _terrain_color(origin.x + i * step, origin.y + j * step, heights[idx], normal.y)

	# Synlig mesh. Ordningen (a,b,c) och (b,d,c) ger uppåtvända framsidor i Godot.
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for j in RESOLUTION:
		for i in RESOLUTION:
			_emit_vertex(st, heights, normals, colors, origin, i, j, step)
			_emit_vertex(st, heights, normals, colors, origin, i + 1, j, step)
			_emit_vertex(st, heights, normals, colors, origin, i, j + 1, step)
			_emit_vertex(st, heights, normals, colors, origin, i + 1, j, step)
			_emit_vertex(st, heights, normals, colors, origin, i + 1, j + 1, step)
			_emit_vertex(st, heights, normals, colors, origin, i, j + 1, step)
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = _terrain_mat
	root.add_child(mi)

	# Kollision: en HeightMapShape3D centrerad i chunkens mitt.
	var body := StaticBody3D.new()
	body.position = Vector3(origin.x + CHUNK_SIZE * 0.5, 0.0, origin.y + CHUNK_SIZE * 0.5)
	var col := CollisionShape3D.new()
	var shape := HeightMapShape3D.new()
	shape.map_width = n
	shape.map_depth = n
	shape.map_data = heights
	col.shape = shape
	body.add_child(col)
	root.add_child(body)

	# Vegetation, stenar och ruiner (deterministiskt per chunk).
	var rng := RandomNumberGenerator.new()
	rng.seed = (key.x * 73856093) ^ (key.y * 19349663) ^ world_seed
	_scatter_vegetation(root, origin, rng)
	if rng.randf() < 0.1:
		_build_ruin(root, origin, rng)
	return root


func _emit_vertex(st: SurfaceTool, heights: PackedFloat32Array, normals: PackedVector3Array, colors: PackedColorArray, origin: Vector2, i: int, j: int, step: float) -> void:
	var n := RESOLUTION + 1
	var idx := j * n + i
	st.set_normal(normals[idx])
	st.set_color(colors[idx])
	st.add_vertex(Vector3(origin.x + i * step, heights[idx], origin.y + j * step))


func _grid_normal(heights: PackedFloat32Array, i: int, j: int, step: float) -> Vector3:
	var n := RESOLUTION + 1
	var il := maxi(i - 1, 0)
	var ir := mini(i + 1, n - 1)
	var jd := maxi(j - 1, 0)
	var ju := mini(j + 1, n - 1)
	var dhdx: float = (heights[j * n + ir] - heights[j * n + il]) / ((ir - il) * step)
	var dhdz: float = (heights[ju * n + i] - heights[jd * n + i]) / ((ju - jd) * step)
	return Vector3(-dhdx, 1.0, -dhdz).normalized()


func _normal_at(x: float, z: float) -> Vector3:
	var e := 0.75
	var dx := (height_at(x + e, z) - height_at(x - e, z)) / (2.0 * e)
	var dz := (height_at(x, z + e) - height_at(x, z - e)) / (2.0 * e)
	return Vector3(-dx, 1.0, -dz).normalized()


func _terrain_color(x: float, z: float, h: float, normal_y: float) -> Color:
	var v := _detail.get_noise_2d(x * 0.7, z * 0.7) * 0.5 + 0.5
	var col := Color(0.30, 0.56, 0.22).lerp(Color(0.2, 0.42, 0.15), v)
	# Sand vid vattnet.
	col = col.lerp(Color(0.86, 0.80, 0.56), 1.0 - smoothstep(WATER_LEVEL + 0.8, WATER_LEVEL + 2.5, h))
	# Klippor på branta sluttningar.
	col = col.lerp(Color(0.46, 0.44, 0.42), 1.0 - smoothstep(0.62, 0.8, normal_y))
	# Snö på höga berg.
	col = col.lerp(Color(0.94, 0.95, 1.0), smoothstep(30.0, 38.0, h))
	return col


func _scatter_vegetation(root: Node3D, origin: Vector2, rng: RandomNumberGenerator) -> void:
	var trunk_xf: Array = []
	var trunk_col: Array = []
	var crown_xf: Array = []
	var crown_col: Array = []
	var bush_xf: Array = []
	var bush_col: Array = []
	var rock_xf: Array = []
	var rock_col: Array = []
	var flower_xf: Array = []
	var flower_col: Array = []

	# Träd (mer tätt i "skogsområden").
	for _t in 10:
		var x := origin.x + rng.randf() * CHUNK_SIZE
		var z := origin.y + rng.randf() * CHUNK_SIZE
		var h := height_at(x, z)
		if h < WATER_LEVEL + 2.0 or h > 26.0:
			continue
		var forest_chance := clampf(_forest.get_noise_2d(x, z) * 0.8 + 0.5, 0.0, 1.0)
		if rng.randf() > forest_chance:
			continue
		if _normal_at(x, z).y < 0.8:
			continue
		var s := rng.randf_range(0.8, 1.4)
		var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s, s))
		var base := Vector3(x, h, z)
		trunk_xf.append(Transform3D(basis, base + Vector3(0.0, 2.0 * s, 0.0)))
		trunk_col.append(Color.WHITE)
		crown_xf.append(Transform3D(basis, base + Vector3(0.0, 4.4 * s, 0.0)))
		crown_col.append(Color.WHITE.lerp(Color(0.7, 0.9, 0.6), rng.randf()))
		_add_cylinder_collider(root, base, 0.35 * s, 4.0 * s)

	# Buskar.
	for _b in 6:
		var x := origin.x + rng.randf() * CHUNK_SIZE
		var z := origin.y + rng.randf() * CHUNK_SIZE
		var h := height_at(x, z)
		if h < WATER_LEVEL + 1.5 or h > 22.0:
			continue
		if _normal_at(x, z).y < 0.85:
			continue
		var s := rng.randf_range(0.6, 1.1)
		var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * 0.8, s))
		bush_xf.append(Transform3D(b, Vector3(x, h + 0.3 * s, z)))
		bush_col.append(Color.WHITE.lerp(Color(0.75, 0.9, 0.6), rng.randf()))

	# Stenar (med kollision).
	for _r in 3:
		var x := origin.x + rng.randf() * CHUNK_SIZE
		var z := origin.y + rng.randf() * CHUNK_SIZE
		var h := height_at(x, z)
		if h < WATER_LEVEL + 0.5:
			continue
		var s := rng.randf_range(0.5, 1.6)
		var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * 0.8, s))
		rock_xf.append(Transform3D(b, Vector3(x, h + 0.1 * s, z)))
		rock_col.append(Color.WHITE.lerp(Color(0.85, 0.85, 0.8), rng.randf()))
		_add_sphere_collider(root, Vector3(x, h + 0.1 * s, z), 0.8 * s)

	# Blommor (dekoration).
	var flower_colors := [Color(1.0, 0.9, 0.3), Color(1.0, 0.5, 0.7), Color(0.95, 0.95, 1.0), Color(0.7, 0.5, 1.0)]
	for _f in 14:
		var x := origin.x + rng.randf() * CHUNK_SIZE
		var z := origin.y + rng.randf() * CHUNK_SIZE
		var h := height_at(x, z)
		if h < WATER_LEVEL + 2.0 or h > 20.0:
			continue
		if _normal_at(x, z).y < 0.92:
			continue
		flower_xf.append(Transform3D(Basis(), Vector3(x, h + 0.1, z)))
		flower_col.append(flower_colors[rng.randi() % flower_colors.size()])

	_add_multimesh(root, _trunk_mesh, _trunk_mat, trunk_xf, trunk_col)
	_add_multimesh(root, _crown_mesh, _foliage_mat, crown_xf, crown_col)
	_add_multimesh(root, _bush_mesh, _foliage_mat, bush_xf, bush_col)
	_add_multimesh(root, _rock_mesh, _rock_mat, rock_xf, rock_col)
	_add_multimesh(root, _flower_mesh, _flower_mat, flower_xf, flower_col)


func _add_multimesh(root: Node3D, mesh: Mesh, mat: Material, xforms: Array, colors: Array) -> void:
	if xforms.is_empty():
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	mm.instance_count = xforms.size()
	for i in xforms.size():
		mm.set_instance_transform(i, xforms[i])
		mm.set_instance_color(i, colors[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = mat
	root.add_child(mmi)


func _add_cylinder_collider(root: Node3D, base: Vector3, radius: float, height: float) -> void:
	var body := StaticBody3D.new()
	body.position = base
	var col := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = radius
	shape.height = height
	col.shape = shape
	col.position = Vector3(0.0, height * 0.5, 0.0)
	body.add_child(col)
	root.add_child(body)


func _add_sphere_collider(root: Node3D, pos: Vector3, radius: float) -> void:
	var body := StaticBody3D.new()
	body.position = pos
	var col := CollisionShape3D.new()
	var shape := SphereShape3D.new()
	shape.radius = radius
	col.shape = shape
	body.add_child(col)
	root.add_child(body)


func _add_static_box(root: Node3D, pos: Vector3, size: Vector3, mat: Material) -> void:
	var body := StaticBody3D.new()
	body.position = pos
	var mi := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	box.material = mat
	mi.mesh = box
	body.add_child(mi)
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	col.shape = shape
	body.add_child(col)
	root.add_child(body)


## En liten övergiven stenruin: en sockel och fyra pelare med olika höjd.
func _build_ruin(root: Node3D, origin: Vector2, rng: RandomNumberGenerator) -> void:
	var rx := origin.x + rng.randf_range(12.0, 36.0)
	var rz := origin.y + rng.randf_range(12.0, 36.0)
	var rh := height_at(rx, rz)
	if rh < WATER_LEVEL + 2.0 or rh > 22.0:
		return
	var base := Vector3(rx, rh, rz)
	_add_static_box(root, base + Vector3(0.0, 0.25, 0.0), Vector3(7.0, 0.5, 7.0), _stone_mat)
	for corner in [Vector2(-3, -3), Vector2(3, -3), Vector2(-3, 3), Vector2(3, 3)]:
		var ph := rng.randf_range(1.5, 4.5)
		_add_static_box(root, base + Vector3(corner.x, 0.5 + ph * 0.5, corner.y), Vector3(1.0, ph, 1.0), _stone_mat)
