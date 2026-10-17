"""cover_lib — cover pattern rendering, split from cover.py (issue #1069).

cover.py re-exports every public name from this package, so both
`python3 cover.py` and `import cover` keep working unchanged.
"""

from .base import _base_css, _cross_hatch, _dot_grid, _gfonts_import
from .patterns_classic import (
    _pattern_diagonal,
    _pattern_frame,
    _pattern_minimal,
    _pattern_stripe,
)
from .patterns_core import (
    _pattern_atmospheric,
    _pattern_fullbleed,
    _pattern_split,
    _pattern_typographic,
)
from .patterns_display import _pattern_poster, _pattern_terminal
from .patterns_editorial import (
    _pattern_darkroom,
    _pattern_editorial,
    _pattern_magazine,
)

PATTERNS = {
    "fullbleed":   _pattern_fullbleed,
    "split":       _pattern_split,
    "typographic": _pattern_typographic,
    "atmospheric": _pattern_atmospheric,
    "minimal":     _pattern_minimal,
    "stripe":      _pattern_stripe,
    "diagonal":    _pattern_diagonal,
    "frame":       _pattern_frame,
    "editorial":   _pattern_editorial,
    "magazine":    _pattern_magazine,
    "darkroom":    _pattern_darkroom,
    "terminal":    _pattern_terminal,
    "poster":      _pattern_poster,
}



def render(tokens: dict) -> str:
    """Dispatch to the cover pattern function and return the HTML string."""
    pattern = tokens.get("cover_pattern", "fullbleed")
    fn = PATTERNS.get(pattern, _pattern_fullbleed)
    return fn(tokens)
