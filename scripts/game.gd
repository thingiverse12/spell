extends Node3D
## Kristalldalen – spelkontroll. Kopplar ihop terräng, spelare, fiender, kristaller,
## HUD och dag/natt-cykeln.

const TerrainScript = preload("res://scripts/terrain.gd")
const PlayerScript = preload("res://scripts/player.gd")
const EnemyScript = preload("res://scripts/enemy.gd")
const CrystalScript = preload("res://scripts/crystal.gd")
const HudScript = preload("res://scripts/hud.gd")

const TOTAL_CRYSTALS := 10
const CRYSTAL_MIN_SPACING := 70.0
const MAX_ENEMIES := 14
const SPAWN_INTERVAL := 1.2
const SPAWN_RING_MIN := 28.0
const SPAWN_RING_MAX := 55.0
const DESPAWN_DISTANCE := 110.0
const DAY_LENGTH := 240.0  # sekunder per spel-dygn

var terrain
var player
var hud
var sun: DirectionalLight3D
var _environment: Environment
var _sky_material: ProceduralSkyMaterial
var _rng := RandomNumberGenerator.new()
var _crystal_nodes: Array = []
var _crystal_positions: Array[Vector3] = []
var _crystals_found := 0
var _kills := 0
var _day := 1
var _day_time := 0.35  # 0 = midnatt, 0.5 = mitt på dagen
var _spawn_timer := 1.0
var _game_over := false
var _won := false


func _ready() -> void:
	_rng.randomize()
	_setup_input()
	_setup_environment()

	hud = HudScript.new()
	add_child(hud)

	terrain = TerrainScript.new()
	terrain.world_seed = _rng.randi()
	add_child(terrain)
	terrain.update_focus(Vector3.ZERO, true)

	var spawn_height: float = terrain.height_at(0.0, 0.0)
	player = PlayerScript.new()
	player.position = Vector3(0.0, spawn_height + 2.0, 0.0)
	add_child(player)
	player.health_changed.connect(_on_player_health_changed)
	player.died.connect(_on_player_died)

	_place_crystals()
	hud.set_crystals(0, TOTAL_CRYSTALS)
	hud.set_kills(0)
	hud.set_health(player.health, player.MAX_HEALTH)
	hud.show_message("Välkommen till Kristalldalen! Hitta %d kristaller i den öppna världen." % TOTAL_CRYSTALS, 6.0)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _process(delta: float) -> void:
	terrain.update_focus(player.global_position)
	_update_day(delta)
	if not _game_over:
		_spawn_timer -= delta
		if _spawn_timer <= 0.0:
			_spawn_timer = SPAWN_INTERVAL
			_try_spawn_enemy()
		_cleanup_enemies()
	_update_nearest_crystal()
	hud.set_time(_day, _day_time)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("release_mouse"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif _game_over and event.is_action_pressed("restart"):
		get_tree().reload_current_scene()
	else:
		var button := event as InputEventMouseButton
		if button and button.pressed and not _game_over and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

func _setup_input() -> void:
	_add_key_action("move_forward", KEY_W)
	_add_key_action("move_back", KEY_S)
	_add_key_action("move_left", KEY_A)
	_add_key_action("move_right", KEY_D)
	_add_key_action("jump", KEY_SPACE)
	_add_key_action("sprint", KEY_SHIFT)
	_add_key_action("restart", KEY_R)
	_add_key_action("release_mouse", KEY_ESCAPE)
	_add_mouse_action("attack", MOUSE_BUTTON_LEFT)


func _add_key_action(action: String, keycode: int) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	var ev := InputEventKey.new()
	ev.physical_keycode = keycode
	InputMap.action_add_event(action, ev)


func _add_mouse_action(action: String, button: int) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	var ev := InputEventMouseButton.new()
	ev.button_index = button
	InputMap.action_add_event(action, ev)


func _setup_environment() -> void:
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 150.0
	add_child(sun)

	_sky_material = ProceduralSkyMaterial.new()
	var sky := Sky.new()
	sky.sky_material = _sky_material

	_environment = Environment.new()
	_environment.background_mode = Environment.BG_SKY
	_environment.sky = sky
	_environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	_environment.ambient_light_energy = 0.9
	_environment.fog_enabled = true
	_environment.fog_density = 0.004
	_environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC

	var world_env := WorldEnvironment.new()
	world_env.environment = _environment
	add_child(world_env)


# ---------------------------------------------------------------------------
# Dag och natt
# ---------------------------------------------------------------------------

func _update_day(delta: float) -> void:
	_day_time += delta / DAY_LENGTH
	if _day_time >= 1.0:
		_day_time -= 1.0
		_day += 1
		hud.show_message("Dag %d börjar" % _day, 3.0)

	var elevation := -cos(_day_time * TAU)  # -1 midnatt, +1 mitt på dagen
	sun.rotation = Vector3(-PI * 0.5 + (_day_time - 0.5) * TAU, 0.8, 0.0)
	sun.light_energy = clampf(elevation * 1.2 + 0.1, 0.0, 1.0)
	sun.light_color = Color(1.0, 0.72, 0.5).lerp(Color(1.0, 0.98, 0.92), clampf(elevation * 2.0, 0.0, 1.0))

	var day_factor := clampf((elevation + 0.2) / 0.4, 0.0, 1.0)
	var top := Color(0.03, 0.04, 0.1).lerp(Color(0.25, 0.5, 0.9), day_factor)
	var horizon := Color(0.07, 0.09, 0.18).lerp(Color(0.72, 0.82, 0.92), day_factor)
	_sky_material.sky_top_color = top
	_sky_material.sky_horizon_color = horizon
	_sky_material.ground_horizon_color = horizon
	_sky_material.ground_bottom_color = horizon.darkened(0.6)
	_environment.fog_light_color = horizon
	_environment.ambient_light_energy = lerpf(0.25, 0.9, day_factor)


# ---------------------------------------------------------------------------
# Kristaller
# ---------------------------------------------------------------------------

func _place_crystals() -> void:
	var attempts := 0
	while _crystal_positions.size() < TOTAL_CRYSTALS and attempts < 2000:
		attempts += 1
		var angle := _rng.randf() * TAU
		var dist := _rng.randf_range(50.0, 420.0)
		var xz := Vector2(cos(angle), sin(angle)) * dist
		var h: float = terrain.height_at(xz.x, xz.y)
		if h < 2.0 or h > 40.0:
			continue
		var pos := Vector3(xz.x, h + 1.4, xz.y)
		var too_close := false
		for other in _crystal_positions:
			if other.distance_to(pos) < CRYSTAL_MIN_SPACING:
				too_close = true
				break
		if too_close:
			continue
		_crystal_positions.append(pos)
		var crystal = CrystalScript.new()
		crystal.position = pos
		crystal.collected.connect(_on_crystal_collected)
		add_child(crystal)
		_crystal_nodes.append(crystal)


func _update_nearest_crystal() -> void:
	var player_pos: Vector3 = player.global_position
	var best := -1.0
	for crystal in _crystal_nodes:
		if is_instance_valid(crystal):
			var d: float = player_pos.distance_to(crystal.global_position)
			if best < 0.0 or d < best:
				best = d
	hud.set_nearest(best)


func _on_crystal_collected(crystal: Node) -> void:
	_crystal_nodes.erase(crystal)
	_crystals_found += 1
	hud.set_crystals(_crystals_found, TOTAL_CRYSTALS)
	if _crystals_found >= TOTAL_CRYSTALS:
		if not _won:
			_won = true
			hud.show_message("Alla kristaller samlade! Du vann – utforska vidare!", 8.0)
	else:
		hud.show_message("Kristall insamlad! (%d kvar)" % (TOTAL_CRYSTALS - _crystals_found), 2.5)


# ---------------------------------------------------------------------------
# Fiender
# ---------------------------------------------------------------------------

func _try_spawn_enemy() -> void:
	if get_tree().get_nodes_in_group("enemies").size() >= MAX_ENEMIES:
		return
	var player_pos: Vector3 = player.global_position
	# Prova flera slumpade punkter så att fiender inte blir sällsynta (t.ex. i vatten).
	for _attempt in 8:
		var angle := _rng.randf() * TAU
		var dist := _rng.randf_range(SPAWN_RING_MIN, SPAWN_RING_MAX)
		var x := player_pos.x + cos(angle) * dist
		var z := player_pos.z + sin(angle) * dist
		var h: float = terrain.height_at(x, z)
		if h < 1.0 or h > 28.0:
			continue
		var enemy = EnemyScript.new()
		enemy.position = Vector3(x, h + 1.0, z)
		enemy.slain.connect(_on_enemy_slain)
		add_child(enemy)
		return


func _cleanup_enemies() -> void:
	var player_pos: Vector3 = player.global_position
	for enemy in get_tree().get_nodes_in_group("enemies"):
		var enemy_pos: Vector3 = enemy.global_position
		var far := Vector2(enemy_pos.x - player_pos.x, enemy_pos.z - player_pos.z).length() > DESPAWN_DISTANCE
		if far or enemy_pos.y < -30.0:
			enemy.queue_free()


func _on_enemy_slain(_enemy: Node) -> void:
	_kills += 1
	hud.set_kills(_kills)


# ---------------------------------------------------------------------------
# Spelaren
# ---------------------------------------------------------------------------

func _on_player_health_changed(current: float, maximum: float) -> void:
	hud.set_health(current, maximum)


func _on_player_died() -> void:
	_game_over = true
	hud.show_death(true)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
