import { useEffect, useState, useCallback } from "react";
import { Dashboard } from "@uppy/react";
import { useUppyWithSupabase } from "../hooks/useUppyWithSupabase";
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";
import "../styles/VideoUpload.css";
import { useQueueStore } from "../lib/store";
import { supabase } from "../lib/supabase";

function VideoUpload({ surveyId, onUploadComplete, accessToken }) {
  const [isUploading, setIsUploading] = useState(false);
  const queue = useQueueStore((state) => state.queue);
  const removeFromQueue = useQueueStore((state) => state.removeFromQueue);
  const uppy = useUppyWithSupabase({
    bucketName: "videos",
    folder: surveyId,
    accessToken: accessToken,
    surveyId: surveyId,
  });

  useEffect(() => {
    const isFirstInQueue = queue[0] === surveyId;
    const files = uppy.getFiles();

    if (isFirstInQueue && files.length > 0 && !isUploading) {
      const state = uppy.getState();
      // Only upload if not already uploading
      if (state.totalProgress === 0 || state.totalProgress === 100) {
        uppy.upload();
      }
    }
  }, [queue, surveyId, uppy, isUploading]);

  const handleUploadComplete = async (surveyId, fileName, uploadId) => {
    //   const toastId = toast.loading("Processing upload...");
    try {
      const { data: videoData, error: videoError } = await supabase
        .from("videos")
        .insert({
          name: fileName,
          url: `https://cdn.bharatnet.survey.rio.software/uploads/${uploadId}`,
          survey_id: surveyId,
        })
        .select()
        .single();

      if (videoError) throw videoError;
      const { error: surveyError } = await supabase
        .from("surveys")
        .update({
          video_id: videoData.id,
          is_video_uploaded: true,
        })
        .eq("id", surveyId);

      await supabase.from("upload_errors").insert({
        survey_id: surveyId,
        error: "success",
      });

      if (surveyError) throw surveyError;

      //  queryClient.invalidateQueries({ queryKey: ["surveys"] });

      //   toast.success("Video uploaded successfully!", { id: toastId });
    } catch (error) {
      console.error("Error processing upload:", error);
      //  toast.error("Failed to process upload", { id: toastId });
    }
  };

  const handleComplete = useCallback(
    (result) => {
      setIsUploading(false);
      if (result.successful?.length > 0) {
        removeFromQueue(surveyId);
        const uploadedFile = result.successful[0];
        //    console.log(uploadedFile, "uploadedFile");
        handleUploadComplete(
          surveyId,
          uploadedFile.name,
          new URL(uploadedFile.uploadURL).pathname.slice("/files/".length)
        );
      }
    },
    [surveyId, handleUploadComplete]
  );

  const handleError = useCallback(
    async (file, error) => {
      setIsUploading(false);
      removeFromQueue(surveyId);

      const errorInfo = {
        source: file.source,
        name: file.meta.name,
        type: file.meta.type,
        size: file.size,
        progress: file.progress,
        uploadURL: file.uploadURL,
        error: error,
        survey_id: surveyId,
      };

      await supabase.from("upload_errors").insert(errorInfo);
      console.error("Upload error:", errorInfo);
    },
    [surveyId, removeFromQueue]
  );

  const handleUploadStart = useCallback(() => {
    setIsUploading(true);
  }, []);

  useEffect(() => {
    uppy.on("upload", handleUploadStart);
    return () => {
      uppy.off("upload", handleUploadStart);
    };
  }, [uppy, handleUploadStart]);

  useEffect(() => {
    uppy.on("complete", handleComplete);
    return () => {
      uppy.off("complete", handleComplete);
    };
  }, [uppy, handleComplete]);

  useEffect(() => {
    uppy.on("upload-error", handleError);
    return () => {
      uppy.off("upload-error", handleError);
    };
  }, [uppy, handleError]);

  return (
    <div className={`upload-container ${isUploading ? "uploading" : ""}`}>
      <Dashboard
        uppy={uppy}
        inline={true}
        // showProgressDetails={true}
        proudlyDisplayPoweredByUppy={false}
        height={180}
        width="100%"
        showRemoveButtonAfterComplete={false}
        theme="light"
        showLinkToFileUploadResult={false}
        className="uppy-dashboard-wrapper"
        doneButtonHandler={null}
      />
    </div>
  );
}

export default VideoUpload;
