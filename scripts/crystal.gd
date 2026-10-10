extends Area3D
## Lysande kristall som spelaren samlar in. Att samla alla vinner spelet.

signal collected(crystal)

var _base_y := 0.0
var _time := 0.0
var _gem: MeshInstance3D
var _taken := false


func _ready() -> void:
	_base_y = position.y

	var col := CollisionShape3D.new()
	var shape := SphereShape3D.new()
	shape.radius = 1.6
	col.shape = shape
	add_child(col)

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.4, 0.9, 1.0)
	mat.emission_enabled = true
	mat.emission = Color(0.3, 0.9, 1.0)
	mat.emission_energy_multiplier = 3.0
	mat.roughness = 0.1

	var mesh := SphereMesh.new()
	mesh.radius = 0.45
	mesh.height = 1.1
	mesh.radial_segments = 6
	mesh.rings = 3
	mesh.material = mat

	_gem = MeshInstance3D.new()
	_gem.mesh = mesh
	add_child(_gem)

	var light := OmniLight3D.new()
	light.light_color = Color(0.5, 0.9, 1.0)
	light.omni_range = 8.0
	light.light_energy = 1.5
	add_child(light)

	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	_time += delta
	_gem.rotation.y += delta * 1.5
	position.y = _base_y + sin(_time * 2.0) * 0.25


func _on_body_entered(body: Node3D) -> void:
	if _taken or not body.is_in_group("player"):
		return
	_taken = true
	collected.emit(self)
	queue_free()
