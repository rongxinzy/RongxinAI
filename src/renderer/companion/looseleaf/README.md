# Looseleaf bubble renderer

Adapted from [Looseleaf](https://github.com/kevintngo/looseleaf), commit
`4bdb647940e2fefb3cebb394f3bad25c766a27d2`, under the adjacent MIT license.
The Bubble ink recipe and its required renderer are retained; unused shapes were
removed and the pen implementation was split. The host maps paint to theme
tokens, keeps its own typography, and stores the original texture tiles locally.
The SVG markup is generated only from bounded layout dimensions, internal ink
parameters and a React-generated seed; message text is rendered separately by
the existing message component and is never interpolated into the markup.
