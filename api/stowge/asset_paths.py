"""Asset path utilities shared between main app and backup/restore."""


def location_photo_variant_paths(photo_path: str | None) -> tuple[str, str, str] | tuple[()]:
    """Given a location photo display path, return (display, thumb, original) paths.

    Returns an empty tuple when photo_path is falsy.
    """
    if not photo_path:
        return ()
    display_path = str(photo_path)
    thumb_path = display_path.replace("/display.", "/thumb.")
    original_path = display_path.replace("/display.", "/original.")
    return (display_path, thumb_path, original_path)
