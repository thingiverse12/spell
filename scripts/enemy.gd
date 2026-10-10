extends CharacterBody3D
## Gobliner: vandrar runt, jagar spelaren när den kommer nära och attackerar.

signal slain(enemy)

const GRAVITY := 22.0
const CHASE_RANGE := 16.0
const ATTACK_RANGE := 1.7
const ATTACK_COOLDOWN := 1.3
const ATTACK_DAMAGE := 8.0
const WANDER_SPEED := 1.6
const CHASE_SPEED := 4.2
const MAX_HP := 3
const HOME_RADIUS := 25.0
const BODY_COLOR := Color(0.3, 0.6, 0.25)

var hp := MAX_HP
var _home := Vector3.ZERO
var _wander_dir := Vector3.ZERO
var _wander_timer := 0.0
var _attack_timer := 0.0
var _knockback := Vector3.ZERO
var _dead := false
var _body_mat: StandardMaterial3D
var _visual: Node3D


func _ready() -> void:
	add_to_group("enemies")
	_home = global_position
	_build()


func _build() -> void:
	var col := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = 0.35
	shape.height = 1.1
	col.shape = shape
	col.position.y = 0.55
	add_child(col)

	_visual = Node3D.new()
	add_child(_visual)

	_body_mat = StandardMaterial3D.new()
	_body_mat.albedo_color = BODY_COLOR
	_body_mat.roughness = 0.8

	var body := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.35
	capsule.height = 1.1
	capsule.material = _body_mat
	body.mesh = capsule
	body.position.y = 0.55
	_visual.add_child(body)

	for side in [-0.14, 0.14]:
		var eye := MeshInstance3D.new()
		var eye_mesh := SphereMesh.new()
		eye_mesh.radius = 0.07
		eye_mesh.height = 0.14
		var eye_mat := StandardMaterial3D.new()
		eye_mat.albedo_color = Color(1.0, 0.9, 0.1)
		eye_mat.emission_enabled = true
		eye_mat.emission = Color(1.0, 0.8, 0.0)
		eye_mat.emission_energy_multiplier = 2.0
		eye_mesh.material = eye_mat
		eye.mesh = eye_mesh
		eye.position = Vector3(side, 1.0, -0.3)
		_visual.add_child(eye)


func _physics_process(delta: float) -> void:
	if _dead:
		return
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	else:
		velocity.y = 0.0
	_attack_timer = maxf(0.0, _attack_timer - delta)

	var player = get_tree().get_first_node_in_group("player")
	var move := Vector3.ZERO
	var speed := 0.0

	if player and not player.is_dead and global_position.distance_to(player.global_position) < CHASE_RANGE:
		var to_player: Vector3 = player.global_position - global_position
		to_player.y = 0.0
		var dist := to_player.length()
		if dist > ATTACK_RANGE:
			move = to_player.normalized()
			speed = CHASE_SPEED
		elif _attack_timer <= 0.0:
			_attack_timer = ATTACK_COOLDOWN
			player.take_damage(ATTACK_DAMAGE)
		if dist > 0.01:
			_face(to_player)
	else:
		_wander_timer -= delta
		if _wander_timer <= 0.0:
			_wander_timer = randf_range(2.0, 4.0)
			var angle := randf() * TAU
			_wander_dir = Vector3(cos(angle), 0.0, sin(angle))
			if randf() < 0.35:
				_wander_dir = Vector3.ZERO  # står still en stund
		if global_position.distance_to(_home) > HOME_RADIUS:
			_wander_dir = Vector3(_home.x - global_position.x, 0.0, _home.z - global_position.z).normalized()
		move = _wander_dir
		speed = WANDER_SPEED
		if _wander_dir.length() > 0.1:
			_face(_wander_dir)

	_knockback = _knockback.move_toward(Vector3.ZERO, 25.0 * delta)
	velocity.x = move.x * speed + _knockback.x
	velocity.z = move.z * speed + _knockback.z
	move_and_slide()

	if global_position.y < -30.0:
		queue_free()


func _face(dir: Vector3) -> void:
	var target_rot := atan2(-dir.x, -dir.z)
	_visual.rotation.y = lerp_angle(_visual.rotation.y, target_rot, 0.2)


## Anropas av spelaren när svärdet träffar.
func take_hit(damage: int, from_dir: Vector3) -> void:
	if _dead:
		return
	hp -= damage
	var push := Vector3(from_dir.x, 0.0, from_dir.z).normalized()
	_knockback = push * 7.0
	_body_mat.albedo_color = Color(1.0, 0.25, 0.2)
	var tween := create_tween()
	tween.tween_property(_body_mat, "albedo_color", BODY_COLOR, 0.25)
	if hp <= 0:
		_die()


func _die() -> void:
	_dead = true
	slain.emit(self)
	collision_layer = 0
	collision_mask = 0
	var tween := create_tween()
	tween.tween_property(_visual, "scale", Vector3(1.3, 0.1, 1.3), 0.35)
	tween.tween_callback(queue_free)
