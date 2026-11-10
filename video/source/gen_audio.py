import json, subprocess, sys
for s in json.load(open("script.json")):
    subprocess.run([sys.executable,"tts.py","fr-FR-HenriNeural",s["text"],f"audio/{s['id']}.mp3","-4%"],check=True)
    print(s["id"])
