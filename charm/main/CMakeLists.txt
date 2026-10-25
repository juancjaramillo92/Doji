idf_component_register(
    SRCS main.c face.c glass.c art.c sound.c config.c setup.c dns.c net.c talk.c ogg.c frames.c sleep.c briefing.c lift.c errand.c motion.c ota.c
         gladys.c journal.c dial.c power.c hanken_64.c hanken_16.c hanken_36.c hanken_18.c
    INCLUDE_DIRS .
    # The art, embedded as the bytes the screen draws (charm/tools/art.py), and
    # the setup page's typeface (charm/tools/fonts.sh).
    EMBED_FILES ../art/body.rgb565 ../art/glow.a8 ../art/bubbles.argb8888 setup.woff2
    # The setup's page, served as written.
    EMBED_TXTFILES setup.html)
