idf_component_register(
    SRCS main.c face.c sound.c
    INCLUDE_DIRS .
    # The art, embedded as the bytes the screen draws: charm/tools/art.py makes them.
    EMBED_FILES ../art/eugenia.rgb565 ../art/gladys.rgb565 ../art/blush.argb)
