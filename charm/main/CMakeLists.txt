idf_component_register(
    SRCS main.c face.c sound.c config.c setup.c net.c talk.c sleep.c briefing.c
         gladys.c journal.c dial.c hanken_64.c hanken_16.c hanken_36.c
    INCLUDE_DIRS .
    # The art, embedded as the bytes the screen draws: charm/tools/art.py makes them.
    EMBED_FILES ../art/eugenia.rgb565 ../art/gladys.rgb565 ../art/blush.argb)
