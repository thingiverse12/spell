extends CanvasLayer
## Spelets HUD: kristaller, monster, klocka, hälsa, meddelanden och dödsskärm.

var _crystal_label: Label
var _kill_label: Label
var _time_label: Label
var _nearest_label: Label
var _health_label: Label
var _health_bar: ProgressBar
var _message_label: Label
var _message_timer := 0.0
var _death_panel: ColorRect


func _ready() -> void:
	layer = 1

	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	# Uppe till vänster: status.
	var top_left := VBoxContainer.new()
	top_left.position = Vector2(16, 14)
	top_left.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(top_left)
	_crystal_label = _make_label(22)
	_kill_label = _make_label(18)
	_time_label = _make_label(18)
	_nearest_label = _make_label(18)
	top_left.add_child(_crystal_label)
	top_left.add_child(_kill_label)
	top_left.add_child(_time_label)
	top_left.add_child(_nearest_label)

	# Nere till vänster: hälsa.
	var bottom_left := VBoxContainer.new()
	bottom_left.anchor_top = 1.0
	bottom_left.anchor_bottom = 1.0
	bottom_left.offset_left = 16
	bottom_left.offset_top = -80
	bottom_left.offset_right = 340
	bottom_left.offset_bottom = -16
	bottom_left.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(bottom_left)
	_health_label = _make_label(18)
	bottom_left.add_child(_health_label)
	_health_bar = ProgressBar.new()
	_health_bar.custom_minimum_size = Vector2(300, 22)
	_health_bar.show_percentage = false
	_health_bar.min_value = 0.0
	bottom_left.add_child(_health_bar)

	# Uppe till höger: kontroller.
	var help := _make_label(15)
	help.text = "WASD: gå  ·  Shift: spring  ·  Mellanslag: hoppa\nVänster musknapp: attackera  ·  Mus: kamera  ·  Esc: visa musmarkör  ·  R: starta om"
	help.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	help.anchor_left = 1.0
	help.anchor_right = 1.0
	help.offset_left = -700
	help.offset_right = -16
	help.offset_top = 14
	help.offset_bottom = 60
	root.add_child(help)

	# Mitt på skärmen: sikte.
	var crosshair := _make_label(22)
	crosshair.text = "+"
	crosshair.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	crosshair.anchor_left = 0.5
	crosshair.anchor_right = 0.5
	crosshair.anchor_top = 0.5
	crosshair.anchor_bottom = 0.5
	crosshair.offset_left = -12
	crosshair.offset_right = 12
	crosshair.offset_top = -18
	crosshair.offset_bottom = 18
	root.add_child(crosshair)

	# Högst upp i mitten: meddelanden.
	_message_label = _make_label(24)
	_message_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_message_label.anchor_left = 0.5
	_message_label.anchor_right = 0.5
	_message_label.offset_left = -500
	_message_label.offset_right = 500
	_message_label.offset_top = 90
	_message_label.offset_bottom = 130
	_message_label.modulate.a = 0.0
	root.add_child(_message_label)

	# Dödsskärm.
	_death_panel = ColorRect.new()
	_death_panel.color = Color(0.0, 0.0, 0.0, 0.7)
	_death_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	_death_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_death_panel.visible = false
	root.add_child(_death_panel)
	var death_label := _make_label(40)
	death_label.text = "Du föll i strid...\n\nTryck R för att försöka igen"
	death_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	death_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	death_label.anchor_right = 1.0
	death_label.anchor_bottom = 1.0
	_death_panel.add_child(death_label)


func _make_label(font_size: int) -> Label:
	var label := Label.new()
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	label.add_theme_constant_override("outline_size", 6)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label


func _process(delta: float) -> void:
	if _message_timer > 0.0:
		_message_timer -= delta
		_message_label.modulate.a = clampf(_message_timer, 0.0, 1.0)


func set_crystals(found: int, total: int) -> void:
	_crystal_label.text = "Kristaller: %d / %d" % [found, total]


func set_kills(count: int) -> void:
	_kill_label.text = "Monster besegrade: %d" % count


func set_time(day: int, day_time: float) -> void:
	var minutes := int(day_time * 1440.0) % 1440
	_time_label.text = "Dag %d  ·  %02d:%02d" % [day, minutes / 60, minutes % 60]


func set_nearest(distance: float) -> void:
	if distance < 0.0:
		_nearest_label.text = "Inga kristaller kvar"
	else:
		_nearest_label.text = "Närmaste kristall: %d m" % int(distance)


func set_health(current: float, maximum: float) -> void:
	_health_bar.max_value = maximum
	_health_bar.value = current
	_health_label.text = "Hälsa: %d / %d" % [int(ceil(current)), int(maximum)]


func show_message(text: String, seconds := 3.0) -> void:
	_message_label.text = text
	_message_label.modulate.a = 1.0
	_message_timer = seconds


func show_death(is_visible: bool) -> void:
	_death_panel.visible = is_visible
