import { useState, useEffect } from "react";
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import Tus from "@uppy/tus";
import { useQueueStore } from "../lib/store";
import { supabase } from "../lib/supabase";

const EDGE_FUNCTION_URL = import.meta.env.VITE_EDGE_FUNCTION;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB

export const useUppyWithSupabase = ({
  bucketName,
  folder = "",
  restrictions = {},
  surveyId = null,
  useS3 = true, // default true for Edge multipart mode
}) => {
  const addToQueue = useQueueStore((state) => state.addToQueue);

  const [uppy] = useState(() => {
    const uniqueId = `uppy-${bucketName}-${surveyId || folder}`;

    const instance = new Uppy({
      id: uniqueId,
      autoProceed: false,
      allowMultipleUploadBatches: false,
      restrictions: {
        maxNumberOfFiles: 1,
        allowedFileTypes: ["video/*", "application/zip", "image/*"],
        ...restrictions,
      },
    });

    // ✅ Supabase Edge Function + Cloudflare R2 multipart logic
    if (useS3) {
      instance.use(AwsS3, {
        shouldUseMultipart: (file) => file.size > MULTIPART_THRESHOLD,
        getChunkSize: () => CHUNK_SIZE,

        // --- Single PUT presigned upload ---
        getUploadParameters: async (file) => {
          const ts = new Date().toISOString();
          const objectName = folder ? `${folder}/${file.name}` : file.name;

          const resp = await fetch(EDGE_FUNCTION_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              fileName: objectName,
              fileSizeBytes: file.size,
              fileType: file.type,
              dateTimestamp: ts,
            }),
          });

          if (!resp.ok) {
            throw new Error(
              `Init (single) failed: ${resp.status} ${await resp.text()}`,
            );
          }

          const body = await resp.json();
          file.meta.dateTimestamp = ts;
          file.meta.fileSizeBytes = file.size;

          return {
            method: "PUT",
            url: body.uploadUrl,
            headers: { "Content-Type": file.type },
          };
        },

        // --- Multipart Upload: init ---
        createMultipartUpload: async (file) => {
          const ts = new Date().toISOString();
          const objectName = folder ? `${folder}/${file.name}` : file.name;

          const resp = await fetch(EDGE_FUNCTION_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              fileName: objectName,
              fileSizeBytes: file.size,
              fileType: file.type,
              dateTimestamp: ts,
            }),
          });

          if (!resp.ok)
            throw new Error(
              `Init (multipart) failed: ${resp.status} ${await resp.text()}`,
            );
          const body = await resp.json();

          file.meta.dateTimestamp = ts;
          file.meta.fileSizeBytes = file.size;

          return { uploadId: body.uploadId, key: body.fileKey };
        },

        // --- Sign each part ---
        signPart: async (file, { uploadId, partNumber }) => {
          const objectName = folder ? `${folder}/${file.name}` : file.name;
          const resp = await fetch(EDGE_FUNCTION_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              fileName: objectName,
              fileSizeBytes: file.meta.fileSizeBytes || file.size,
              fileType: file.type,
              dateTimestamp: file.meta.dateTimestamp,
              partNumber,
              uploadId,
            }),
          });

          if (!resp.ok)
            throw new Error(
              `Sign part ${partNumber} failed: ${resp.status} ${await resp.text()}`,
            );
          const body = await resp.json();
          return { url: body.uploadUrl };
        },

        // --- Complete multipart upload ---
        completeMultipartUpload: async (file, uploadData) => {
          const objectName = folder ? `${folder}/${file.name}` : file.name;
          const totalChunks = Math.ceil(
            (file.meta.fileSizeBytes || file.size) / CHUNK_SIZE,
          );

          const resp = await fetch(EDGE_FUNCTION_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              fileName: objectName,
              fileSizeBytes: file.meta.fileSizeBytes || file.size,
              fileType: file.type,
              dateTimestamp: file.meta.dateTimestamp,
              partNumber: totalChunks + 1,
              uploadId: uploadData.uploadId,
              parts: uploadData.parts,
            }),
          });

          if (!resp.ok)
            throw new Error(
              `Complete failed: ${resp.status} ${await resp.text()}`,
            );
          const body = await resp.json();
          return { location: body.location };
        },

        // --- Abort upload if cancelled ---
        abortMultipartUpload: async (file, { uploadId }) => {
          const objectName = folder ? `${folder}/${file.name}` : file.name;
          try {
            await fetch(EDGE_FUNCTION_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                apikey: SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({
                action: "abort",
                uploadId,
                fileName: objectName,
                fileType: file.type,
                fileSizeBytes: file.meta.fileSizeBytes || file.size,
                dateTimestamp: file.meta.dateTimestamp,
              }),
            });
          } catch (e) {
            console.warn("Abort failed (ignored):", e);
          }
        },
      });
    }

    // ✅ fallback: TUS (if needed)
    else {
      instance.use(Tus, {
        endpoint: `https://uploads.signals.rio.software/files/`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024,
      });
    }

    return instance;
  });

  // --- Event Listeners ---
  useEffect(() => {
    const handleFileAdded = (file) => {
      const objectName = folder ? `${folder}/${file.name}` : file.name;
      file.meta = {
        ...file.meta,
        bucketName,
        objectName,
        contentType: file.type,
      };
      if (surveyId) addToQueue(surveyId);
    };

    const handleError = async (error) => {
      console.error("Uppy Error:", error);
      if (surveyId) {
        const { error: dbError } = await supabase
          .from("upload_errors")
          .insert({ survey_id: surveyId, error: JSON.stringify(error) });
        if (dbError) console.error("Error logging upload error:", dbError);
      }
    };

    uppy.on("file-added", handleFileAdded);
    uppy.on("error", handleError);

    uppy.on("complete", (result) => {
      console.log("Upload complete:", result);
    });

    return () => {
      uppy.off("file-added", handleFileAdded);
      uppy.off("error", handleError);
    };
  }, [uppy, bucketName, folder, surveyId, addToQueue]);

  useEffect(() => {
    return () => uppy.cancelAll();
  }, [uppy]);

  return uppy;
};
