extends CharacterBody3D
## Spelaren: tredjepersonskamera, rörelse, hopp, svärd och hälsa.

signal health_changed(current: float, maximum: float)
signal died

const WALK_SPEED := 6.0
const SPRINT_SPEED := 10.0
const JUMP_VELOCITY := 7.5
const GRAVITY := 22.0
const MOUSE_SENSITIVITY := 0.0025
const MAX_HEALTH := 100.0
const ATTACK_COOLDOWN := 0.45
const ATTACK_RANGE := 2.4
const ATTACK_DAMAGE := 1
const REGEN_DELAY := 5.0
const REGEN_RATE := 4.0
const WATER_LEVEL := 0.0
const FALL_LIMIT := -60.0

var health := MAX_HEALTH
var is_dead := false
var controls_enabled := true

var _attack_timer := 0.0
var _since_damage := 99.0
var _yaw_pivot: Node3D
var _pitch_arm: SpringArm3D
var _camera: Camera3D
var _model: Node3D
var _sword_pivot: Node3D


func _ready() -> void:
	add_to_group("player")
	_build_body()
	_build_camera()


func _build_body() -> void:
	var col := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = 0.4
	shape.height = 1.8
	col.shape = shape
	col.position.y = 0.9
	add_child(col)

	_model = Node3D.new()
	add_child(_model)

	var body := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.4
	cap.height = 1.8
	cap.material = _color_material(Color(0.2, 0.35, 0.85))
	body.mesh = cap
	body.position.y = 0.9
	_model.add_child(body)

	var head := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.28
	sphere.height = 0.56
	sphere.material = _color_material(Color(0.95, 0.8, 0.65))
	head.mesh = sphere
	head.position.y = 1.95
	_model.add_child(head)

	# Svärdet sitter i höger hand och svingas vid attack.
	_sword_pivot = Node3D.new()
	_sword_pivot.position = Vector3(0.42, 1.1, -0.1)
	_sword_pivot.rotation.x = 0.3
	_model.add_child(_sword_pivot)

	var blade := MeshInstance3D.new()
	var blade_mesh := BoxMesh.new()
	blade_mesh.size = Vector3(0.08, 0.05, 1.0)
	blade_mesh.material = _color_material(Color(0.85, 0.88, 0.95))
	blade.mesh = blade_mesh
	blade.position = Vector3(0.0, 0.0, -0.55)
	_sword_pivot.add_child(blade)

	var hilt := MeshInstance3D.new()
	var hilt_mesh := BoxMesh.new()
	hilt_mesh.size = Vector3(0.28, 0.07, 0.07)
	hilt_mesh.material = _color_material(Color(0.6, 0.45, 0.15))
	hilt.mesh = hilt_mesh
	_sword_pivot.add_child(hilt)


func _build_camera() -> void:
	_yaw_pivot = Node3D.new()
	_yaw_pivot.position = Vector3(0.0, 1.5, 0.0)
	add_child(_yaw_pivot)

	_pitch_arm = SpringArm3D.new()
	_pitch_arm.spring_length = 5.0
	_pitch_arm.margin = 0.2
	_pitch_arm.rotation.x = -0.3
	_pitch_arm.add_excluded_object(get_rid())
	_yaw_pivot.add_child(_pitch_arm)

	_camera = Camera3D.new()
	_camera.fov = 70.0
	_camera.current = true
	_pitch_arm.add_child(_camera)


func _color_material(color: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = 0.8
	return m


func _unhandled_input(event: InputEvent) -> void:
	var motion := event as InputEventMouseMotion
	if motion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_yaw_pivot.rotate_y(-motion.relative.x * MOUSE_SENSITIVITY)
		_pitch_arm.rotation.x = clampf(_pitch_arm.rotation.x - motion.relative.y * MOUSE_SENSITIVITY, -1.2, 0.4)


func _physics_process(delta: float) -> void:
	_attack_timer = maxf(0.0, _attack_timer - delta)
	_since_damage += delta
	if health < MAX_HEALTH and not is_dead and _since_damage > REGEN_DELAY:
		health = minf(MAX_HEALTH, health + REGEN_RATE * delta)
		health_changed.emit(health, MAX_HEALTH)

	var can_act := controls_enabled and not is_dead

	if not is_on_floor():
		velocity.y -= GRAVITY * delta

	var input_dir := Vector2.ZERO
	if can_act:
		input_dir = Input.get_vector("move_left", "move_right", "move_forward", "move_back")

	# Rörelse relativt till kameran.
	var move_dir: Vector3 = _yaw_pivot.global_basis * Vector3(input_dir.x, 0.0, input_dir.y)
	move_dir.y = 0.0
	move_dir = move_dir.normalized()

	var speed := WALK_SPEED
	if can_act and Input.is_action_pressed("sprint"):
		speed = SPRINT_SPEED
	if global_position.y < WATER_LEVEL + 0.5:
		speed *= 0.55  # vadar i vatten

	var target := move_dir * speed
	var accel := 14.0 if is_on_floor() else 4.0
	velocity.x = lerpf(velocity.x, target.x, clampf(accel * delta, 0.0, 1.0))
	velocity.z = lerpf(velocity.z, target.z, clampf(accel * delta, 0.0, 1.0))

	if can_act and is_on_floor() and Input.is_action_just_pressed("jump"):
		velocity.y = JUMP_VELOCITY

	move_and_slide()

	# Spelaren vänder sig i rörelseriktningen.
	if move_dir.length() > 0.1:
		var target_rot := atan2(-move_dir.x, -move_dir.z)
		_model.rotation.y = lerp_angle(_model.rotation.y, target_rot, clampf(12.0 * delta, 0.0, 1.0))

	if can_act and Input.is_action_just_pressed("attack") and _attack_timer <= 0.0:
		_attack()

	if global_position.y < FALL_LIMIT and not is_dead:
		take_damage(9999.0)


func _attack() -> void:
	_attack_timer = ATTACK_COOLDOWN
	_swing_sword()
	var forward: Vector3 = -_model.global_basis.z
	forward.y = 0.0
	forward = forward.normalized()
	for enemy in get_tree().get_nodes_in_group("enemies"):
		var to_enemy: Vector3 = enemy.global_position - global_position
		to_enemy.y = 0.0
		if to_enemy.length() <= ATTACK_RANGE and to_enemy.normalized().dot(forward) > 0.3:
			enemy.take_hit(ATTACK_DAMAGE, forward)


func _swing_sword() -> void:
	var tween := create_tween()
	tween.tween_property(_sword_pivot, "rotation:x", -1.0, 0.1).from(1.2)
	tween.tween_property(_sword_pivot, "rotation:x", 0.3, 0.25)


func take_damage(amount: float) -> void:
	if is_dead:
		return
	health = maxf(0.0, health - amount)
	_since_damage = 0.0
	health_changed.emit(health, MAX_HEALTH)
	if health <= 0.0:
		is_dead = true
		died.emit()
