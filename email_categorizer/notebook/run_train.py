import json
import math
import os
import re
import numpy as np
import pandas as pd

def train_and_export():
    csv_path = "emails.csv"
    if not os.path.exists(csv_path):
        csv_path = "../notebook/emails.csv"
        if not os.path.exists(csv_path):
            csv_path = "email_categorizer/notebook/emails.csv"

    print(f"Loading email dataset from: {csv_path}")
    df = pd.read_csv(csv_path)
    df['text'] = df['subject'].fillna('') + " " + df['body'].fillna('')
    documents = df['text'].tolist()
    N = len(documents)
    print(f"Total documents: {N}")

    stop_words = {
        'the', 'a', 'an', 'is', 'it', 'in', 'on', 'of', 'for', 'to', 'and', 
        'or', 'with', 'this', 'that', 'by', 'from', 'at', 'be', 'are', 'was', 
        'were', 'your', 'our', 'my', 'have', 'has', 'had', 'you', 'we', 'will', 
        'can', 'should', 'all', 'more', 'new', 'get', 'not', 'if', 'so', 'as', 
        'but', 'they', 'their', 'them', 'who', 'which', 'what', 'when', 'where'
    }

    def tokenize(text):
        tokens = re.findall(r'\b[a-z0-9]{2,}\b', str(text).lower())
        return [t for t in tokens if t not in stop_words]

    tokenized_docs = [tokenize(doc) for doc in documents]

    # Build vocabulary
    vocab_set = set()
    for doc in tokenized_docs:
        vocab_set.update(doc)

    feature_names = sorted(list(vocab_set))
    vocab = {word: idx for idx, word in enumerate(feature_names)}
    V = len(feature_names)
    print(f"Vocabulary size: {V}")

    # Compute Document Frequency (df)
    df_counts = [0] * V
    for doc in tokenized_docs:
        unique_words = set(doc)
        for w in unique_words:
            df_counts[vocab[w]] += 1

    # Compute Inverse Document Frequency (IDF): log((N+1)/(df+1)) + 1
    idf_weights = [math.log((N + 1) / (df_val + 1)) + 1.0 for df_val in df_counts]

    # Construct dense TF-IDF matrix A (N x V)
    A = np.zeros((N, V), dtype=np.float64)
    for doc_idx, doc in enumerate(tokenized_docs):
        word_counts = {}
        for w in doc:
            word_counts[w] = word_counts.get(w, 0) + 1

        for w, count in word_counts.items():
            col_idx = vocab[w]
            tf = math.log(1 + count)
            A[doc_idx, col_idx] = tf * idf_weights[col_idx]

        norm = np.linalg.norm(A[doc_idx])
        if norm > 0:
            A[doc_idx] /= norm

    # Manual Truncated SVD
    U, S, Vt = np.linalg.svd(A, full_matrices=False)
    k = min(50, N, V)
    V_k = Vt[:k, :].T  # Matrix of shape (V x k)

    # Document vectors in 50D SVD space: (N x k)
    X_svd = A @ V_k
    norms = np.linalg.norm(X_svd, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X_svd = X_svd / norms

    # Seed Centroids
    seed_dict = {
        "Education": ["syllabus", "lecture", "assignment", "campus", "professor"],
        "Work": ["invoice", "meeting", "client", "report", "deadline"],
        "Finance": ["transaction", "balance", "mortgage", "stock", "bank"],
        "Promotions": ["sale", "discount", "coupon", "newsletter", "free"]
    }

    def transform_text(text):
        doc_tokens = tokenize(text)
        vec = np.zeros(V, dtype=np.float64)
        word_counts = {}
        for w in doc_tokens:
            word_counts[w] = word_counts.get(w, 0) + 1
        for w, count in word_counts.items():
            if w in vocab:
                col_idx = vocab[w]
                tf = math.log(1 + count)
                vec[col_idx] = tf * idf_weights[col_idx]
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec

    centroids = {}
    for cat, seeds in seed_dict.items():
        seed_text = " ".join(seeds)
        seed_vec = transform_text(seed_text)
        svd_c = seed_vec @ V_k
        c_norm = np.linalg.norm(svd_c)
        if c_norm > 0:
            svd_c /= c_norm
        centroids[cat] = svd_c.tolist()

    # Validation: Print top 5 emails similar to "Work" centroid
    work_centroid = np.array(centroids["Work"])
    sims = X_svd @ work_centroid
    top5_indices = np.argsort(sims)[::-1][:5]

    print("\n--- Top 5 Emails Most Similar to 'Work' Centroid ---")
    for rank, idx in enumerate(top5_indices, 1):
        subj = df.iloc[idx]['subject']
        score = sims[idx]
        print(f"{rank}. [{score*100:.1f}% match] {subj}")

    # Export artifacts to extension/assets/
    assets_dir = "../extension/assets"
    if not os.path.exists(assets_dir):
        assets_dir = "email_categorizer/extension/assets"
    os.makedirs(assets_dir, exist_ok=True)

    with open(os.path.join(assets_dir, "vocab.json"), "w") as f:
        json.dump(vocab, f, indent=2)

    with open(os.path.join(assets_dir, "idf_weights.json"), "w") as f:
        json.dump(idf_weights, f, indent=2)

    # svd_matrix: (V x k) list of 50-D lists for each word
    with open(os.path.join(assets_dir, "svd_matrix.json"), "w") as f:
        json.dump(V_k.tolist(), f, indent=2)

    with open(os.path.join(assets_dir, "centroids.json"), "w") as f:
        json.dump(centroids, f, indent=2)

    print(f"\nSuccessfully exported all 4 model weight JSON files to: {assets_dir}/")

if __name__ == "__main__":
    train_and_export()
