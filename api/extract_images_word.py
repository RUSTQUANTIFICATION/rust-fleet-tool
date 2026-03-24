import zipfile
import os


def extract_images_word(file_path, output_dir):

    os.makedirs(output_dir, exist_ok=True)

    saved = []

    with zipfile.ZipFile(file_path) as doc:

        for file in doc.namelist():

            if file.startswith("word/media/"):

                data = doc.read(file)

                name = os.path.basename(file)

                path = os.path.join(output_dir, name)

                with open(path, "wb") as f:
                    f.write(data)

                saved.append(path)

    return saved