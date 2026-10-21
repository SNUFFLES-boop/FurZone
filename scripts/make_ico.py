# Packs desktop/icon/*.png into desktop/Pawst.ico.
import os
from PIL import Image
root = os.path.join(os.path.dirname(__file__), '..', 'desktop')
sizes = [16, 24, 32, 48, 64, 128, 256]
img = Image.open(os.path.join(root, 'icon', '256.png')).convert('RGBA')
img.save(os.path.join(root, 'Pawst.ico'), sizes=[(s, s) for s in sizes])
print('Pawst.ico written')
