from azure.cognitiveservices.vision.customvision.training import CustomVisionTrainingClient
from azure.cognitiveservices.vision.customvision.training.models import ImageFileCreateBatch, ImageFileCreateEntry, Region
from msrest.authentication import ApiKeyCredentials
import time
import json
import os

def main():
    from dotenv import load_dotenv
    global training_client
    global custom_vision_project

    os.system('cls' if os.name=='nt' else 'clear')

    try:
        load_dotenv()
        training_endpoint = os.getenv('TrainingEndpoint')
        training_key = os.getenv('TrainingKey')
        project_id = os.getenv('ProjectID')

        credentials = ApiKeyCredentials(in_headers={"Training-key": training_key})
        training_client = CustomVisionTrainingClient(training_endpoint, credentials)

        custom_vision_project = training_client.get_project(project_id)

        Upload_Images('images')
    except Exception as ex:
        print(ex)


def Upload_Images(folder):
    print("Uploading images...")

    tags = training_client.get_tags(custom_vision_project.id)

    tagged_images_with_regions = []

    with open('tagged-images.json', 'r') as json_file:
        tagged_images = json.load(json_file)
        for image in tagged_images['files']:
            file = image['filename']
            regions = []
            for tag in image['tags']:
                tag_name = tag['tag']
                tag_id = next(t for t in tags if t.name == tag_name).id
                regions.append(Region(tag_id=tag_id, left=tag['left'],top=tag['top'],width=tag['width'],height=tag['height']))
            with open(os.path.join(folder,file), mode="rb") as image_data:
                tagged_images_with_regions.append(ImageFileCreateEntry(name=file, contents=image_data.read(), regions=regions))

    upload_result = training_client.create_images_from_files(custom_vision_project.id, ImageFileCreateBatch(images=tagged_images_with_regions))
    if not upload_result.is_batch_successful:
        print("Image batch upload failed.")
        for image in upload_result.images:
            print("Image status: ", image.status)
    else:
        print("Images uploaded.")

if __name__ == "__main__":
    main()
