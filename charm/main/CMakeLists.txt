idf_component_register(
    SRCS main.c face.c sound.c config.c setup.c dns.c net.c talk.c sleep.c briefing.c lift.c motion.c ota.c
         gladys.c journal.c dial.c power.c hanken_64.c hanken_16.c hanken_36.c hanken_18.c
    INCLUDE_DIRS .
    # The art, embedded as the bytes the screen draws: charm/tools/art.py makes them.
    EMBED_FILES ../art/eugenia.rgb565 ../art/gladys.rgb565 ../art/blush.argb
    # The setup's page, served as written.
    EMBED_TXTFILES setup.html)
